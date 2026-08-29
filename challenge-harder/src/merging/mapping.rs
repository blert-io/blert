//! Mappings between different clients' tick spaces in a merge.
#![expect(dead_code)]

use super::alignment::AlignmentEntry;
use crate::lifecycle::core::types::ClientId;

/// Maps tick numbers between a client's local tick space and a merged
/// timeline's tick space.
#[derive(Debug)]
pub(super) struct TickMapping {
    forward: Vec<Option<usize>>,
    reverse: Vec<Option<usize>>,
}

impl TickMapping {
    fn new(forward: Vec<Option<usize>>, reverse: Vec<Option<usize>>) -> Self {
        Self { forward, reverse }
    }

    /// Creates an identity mapping where client tick N maps to merged tick N.
    pub fn identity(tick_count: usize) -> Self {
        let mapping: Vec<Option<usize>> = (0..tick_count).map(Some).collect();
        Self {
            forward: mapping.clone(),
            reverse: mapping,
        }
    }

    /// Builds base and target tick mappings from a list of local alignments.
    pub fn from_alignment(
        base_tick_count: usize,
        target_tick_count: usize,
        alignments: &[Vec<AlignmentEntry>],
    ) -> Mappings {
        let mut base_to_merged = vec![None; base_tick_count];
        let mut target_to_merged = vec![None; target_tick_count];

        let mut merged_pos = 0usize;
        let mut base_pos = 0usize;

        // When the first merge is at base tick 0, any target ticks before it
        // are one-sided and unambiguous; prepend them.
        if let Some(first_entries) = alignments.first() {
            let AlignmentEntry::Merge {
                base_index,
                target_index,
                ..
            } = first_entries[0]
            else {
                unreachable!("local alignment starts with a merge entry");
            };
            if base_index == 0 && target_index > 0 {
                for slot in &mut target_to_merged[..target_index] {
                    *slot = Some(merged_pos);
                    merged_pos += 1;
                }
            }
        }

        // Walk through the alignment entries. Between alignments, copy base
        // ticks natural positions. Within each local alignment, `Merge` maps
        // both base and target to the same position, `Keep` maps the base tick,
        // and `Insert` maps the target tick, increasing the merged tick count.
        for entries in alignments {
            let AlignmentEntry::Merge {
                base_index: first_base,
                ..
            } = entries[0]
            else {
                unreachable!("local alignment starts with a merge entry");
            };
            let AlignmentEntry::Merge {
                base_index: last_base,
                ..
            } = entries[entries.len() - 1]
            else {
                unreachable!("local alignment ends with a merge entry");
            };

            while base_pos < first_base {
                base_to_merged[base_pos] = Some(merged_pos);
                merged_pos += 1;
                base_pos += 1;
            }

            for entry in entries {
                match entry {
                    AlignmentEntry::Merge {
                        base_index,
                        target_index,
                        ..
                    } => {
                        base_to_merged[*base_index] = Some(merged_pos);
                        target_to_merged[*target_index] = Some(merged_pos);
                    }
                    AlignmentEntry::Keep { base_index } => {
                        base_to_merged[*base_index] = Some(merged_pos);
                    }
                    AlignmentEntry::Insert { target_index } => {
                        target_to_merged[*target_index] = Some(merged_pos);
                    }
                }
                merged_pos += 1;
            }

            base_pos = last_base + 1;
        }

        while base_pos < base_tick_count {
            base_to_merged[base_pos] = Some(merged_pos);
            merged_pos += 1;
            base_pos += 1;
        }

        // When the last merge is at the base's final tick, any target ticks
        // after it are one-sided and unambiguous; append them.
        if let Some(last_entries) = alignments.last() {
            let AlignmentEntry::Merge {
                base_index,
                target_index,
                ..
            } = last_entries[last_entries.len() - 1]
            else {
                unreachable!("local alignment ends with a merge entry");
            };
            if base_index == base_tick_count - 1 && target_index < target_tick_count - 1 {
                for slot in &mut target_to_merged[target_index + 1..] {
                    *slot = Some(merged_pos);
                    merged_pos += 1;
                }
            }
        }

        let merged_tick_count = merged_pos;
        let mut merged_to_base = vec![None; merged_tick_count];
        let mut merged_to_target = vec![None; merged_tick_count];

        for (client_tick, merged_tick) in base_to_merged.iter().enumerate() {
            if let Some(merged_tick) = merged_tick {
                merged_to_base[*merged_tick] = Some(client_tick);
            }
        }
        for (client_tick, merged_tick) in target_to_merged.iter().enumerate() {
            if let Some(merged_tick) = merged_tick {
                merged_to_target[*merged_tick] = Some(client_tick);
            }
        }

        Mappings {
            base: TickMapping::new(base_to_merged, merged_to_base),
            target: TickMapping::new(target_to_merged, merged_to_target),
            merged_tick_count,
        }
    }

    /// The number of client ticks in this mapping.
    pub fn client_tick_count(&self) -> usize {
        self.forward.len()
    }

    /// Maps a client tick index to its merged tick index.
    pub fn to_merged(&self, client_tick: usize) -> Option<usize> {
        self.forward.get(client_tick).copied().flatten()
    }

    /// Maps a merged tick index to its client tick index.
    pub fn to_client(&self, merged_tick: usize) -> Option<usize> {
        self.reverse.get(merged_tick).copied().flatten()
    }
}

/// Tick mappings from a merge step.
#[derive(Debug)]
pub(super) struct Mappings {
    pub base: TickMapping,
    pub target: TickMapping,
    pub merged_tick_count: usize,
}

#[derive(Debug)]
struct MappingChainEntry {
    target_client_id: ClientId,
    mappings: Mappings,
}

/// Tracks the composed tick mapping state across an entire merge operation.
///
/// Each successful merge step appends an entry recording its base and target
/// mappings. To resolve a tick from the current merged space back to any
/// client's original tick space, the chain is walked in reverse.
///
/// While a step is in progress, the mapping stores an in-flight entry for its
/// mapping, which can be either committed or discarded.
#[derive(Debug)]
pub(super) struct MergeMapping {
    base_client_id: ClientId,
    chain: Vec<MappingChainEntry>,
    in_flight: Option<MappingChainEntry>,
}

impl MergeMapping {
    pub fn new(base_client_id: ClientId) -> Self {
        Self {
            base_client_id,
            chain: Vec::new(),
            in_flight: None,
        }
    }

    /// Sets an in-flight mapping for a new merge step.
    pub fn begin(&mut self, target_client_id: ClientId, mappings: Mappings) {
        self.in_flight = Some(MappingChainEntry {
            target_client_id,
            mappings,
        });
    }

    /// Commits the in-flight mapping to the chain.
    pub fn commit(&mut self) {
        if let Some(entry) = self.in_flight.take() {
            self.chain.push(entry);
        }
    }

    /// Discards the in-flight step's mapping.
    pub fn discard(&mut self) {
        self.in_flight = None;
    }

    /// The target client's ID for the in-flight step, if one is in progress.
    pub fn target_client_id(&self) -> Option<ClientId> {
        self.in_flight.as_ref().map(|entry| entry.target_client_id)
    }

    /// The base mapping of the in-flight step, if one is in progress.
    pub fn base_mapping(&self) -> Option<&TickMapping> {
        self.in_flight.as_ref().map(|entry| &entry.mappings.base)
    }

    /// The target mapping of the in-flight step, if one is in progress.
    pub fn target_mapping(&self) -> Option<&TickMapping> {
        self.in_flight.as_ref().map(|entry| &entry.mappings.target)
    }

    /// The merged tick count of the in-flight step, if one is in progress.
    pub fn merged_tick_count(&self) -> Option<usize> {
        self.in_flight
            .as_ref()
            .map(|entry| entry.mappings.merged_tick_count)
    }

    /// Resolves a tick index in the current merged space back to a specific
    /// client's original tick space, or `None` if the tick is not mapped.
    pub fn resolve_client_tick(&self, merged_index: usize, client_id: ClientId) -> Option<usize> {
        let mut current = merged_index;

        if let Some(entry) = &self.in_flight {
            if entry.target_client_id == client_id {
                return entry.mappings.target.to_client(current);
            }
            current = entry.mappings.base.to_client(current)?;
        }

        for entry in self.chain.iter().rev() {
            if entry.target_client_id == client_id {
                return entry.mappings.target.to_client(current);
            }
            current = entry.mappings.base.to_client(current)?;
        }

        if client_id == self.base_client_id {
            return Some(current);
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn merge(base_index: usize, target_index: usize) -> AlignmentEntry {
        AlignmentEntry::Merge {
            base_index,
            target_index,
            score: 1.0,
        }
    }

    fn keep(base_index: usize) -> AlignmentEntry {
        AlignmentEntry::Keep { base_index }
    }

    fn insert(target_index: usize) -> AlignmentEntry {
        AlignmentEntry::Insert { target_index }
    }

    #[test]
    fn identity_maps_every_tick_to_itself() {
        let mapping = TickMapping::identity(5);
        for i in 0..5 {
            assert_eq!(mapping.to_merged(i), Some(i));
            assert_eq!(mapping.to_client(i), Some(i));
        }
    }

    #[test]
    fn identity_returns_none_for_out_of_range_ticks() {
        let mapping = TickMapping::identity(3);
        assert_eq!(mapping.to_merged(3), None);
        assert_eq!(mapping.to_client(3), None);
    }

    #[test]
    fn from_alignment_maps_ticks_with_an_insert() {
        // base:   0,1,_,2,3,4
        // target: 0,1,2,3,4,5
        let alignments = vec![vec![
            merge(0, 0),
            merge(1, 1),
            insert(2),
            merge(2, 3),
            merge(3, 4),
            merge(4, 5),
        ]];

        let result = TickMapping::from_alignment(5, 6, &alignments);
        assert_eq!(result.merged_tick_count, 6);

        assert_eq!(result.base.to_merged(0), Some(0));
        assert_eq!(result.base.to_merged(1), Some(1));
        assert_eq!(result.base.to_merged(2), Some(3));
        assert_eq!(result.base.to_merged(3), Some(4));
        assert_eq!(result.base.to_merged(4), Some(5));
        assert_eq!(result.base.to_merged(5), None);

        assert_eq!(result.target.to_merged(0), Some(0));
        assert_eq!(result.target.to_merged(1), Some(1));
        assert_eq!(result.target.to_merged(2), Some(2));
        assert_eq!(result.target.to_merged(3), Some(3));
        assert_eq!(result.target.to_merged(4), Some(4));
        assert_eq!(result.target.to_merged(5), Some(5));

        assert_eq!(result.base.to_client(0), Some(0));
        assert_eq!(result.base.to_client(1), Some(1));
        assert_eq!(result.base.to_client(2), None);
        assert_eq!(result.base.to_client(3), Some(2));
        assert_eq!(result.base.to_client(4), Some(3));
        assert_eq!(result.base.to_client(5), Some(4));
    }

    #[test]
    fn from_alignment_maps_ticks_with_a_keep() {
        // base:   0,1,2,3
        // target: 0,_,1,2
        let alignments = vec![vec![merge(0, 0), keep(1), merge(2, 1), merge(3, 2)]];

        let result = TickMapping::from_alignment(4, 3, &alignments);
        assert_eq!(result.merged_tick_count, 4);

        assert_eq!(result.base.to_merged(0), Some(0));
        assert_eq!(result.base.to_merged(1), Some(1));
        assert_eq!(result.base.to_merged(2), Some(2));
        assert_eq!(result.base.to_merged(3), Some(3));

        assert_eq!(result.target.to_merged(0), Some(0));
        assert_eq!(result.target.to_merged(1), Some(2));
        assert_eq!(result.target.to_merged(2), Some(3));

        assert_eq!(result.target.to_client(1), None);
    }

    #[test]
    fn from_alignment_includes_base_ticks_before_and_after_the_alignment() {
        // base:   0,1,2,3,4,5
        // target: _,_,0,1,_,_
        let alignments = vec![vec![merge(2, 0), merge(3, 1)]];

        let result = TickMapping::from_alignment(6, 2, &alignments);
        assert_eq!(result.merged_tick_count, 6);

        assert_eq!(result.base.to_merged(0), Some(0));
        assert_eq!(result.base.to_merged(1), Some(1));
        assert_eq!(result.base.to_merged(2), Some(2));
        assert_eq!(result.base.to_merged(3), Some(3));
        assert_eq!(result.base.to_merged(4), Some(4));
        assert_eq!(result.base.to_merged(5), Some(5));

        assert_eq!(result.target.to_merged(0), Some(2));
        assert_eq!(result.target.to_merged(1), Some(3));
    }

    #[test]
    fn from_alignment_prepends_leading_target_ticks_when_base_starts_at_the_first_merge() {
        // base:   _,_,0,1,2,3,4,5
        // target: 0,1,2,3,_,_,_,_
        let alignments = vec![vec![merge(0, 2), merge(1, 3)]];

        let result = TickMapping::from_alignment(6, 4, &alignments);
        assert_eq!(result.merged_tick_count, 8);

        assert_eq!(result.target.to_merged(0), Some(0));
        assert_eq!(result.target.to_merged(1), Some(1));
        assert_eq!(result.target.to_merged(2), Some(2));
        assert_eq!(result.target.to_merged(3), Some(3));
        assert_eq!(result.base.to_merged(0), Some(2));
        assert_eq!(result.base.to_merged(1), Some(3));
        assert_eq!(result.base.to_merged(5), Some(7));

        assert_eq!(result.base.to_client(0), None);
        assert_eq!(result.base.to_client(1), None);
        assert_eq!(result.target.to_client(0), Some(0));
        assert_eq!(result.target.to_client(1), Some(1));
    }

    #[test]
    fn from_alignment_appends_trailing_target_ticks_when_base_ends_at_the_last_merge() {
        // base:   0,1,2,3,4,5,_,_
        // target: _,_,_,_,0,1,2,3
        let alignments = vec![vec![merge(4, 0), merge(5, 1)]];

        let result = TickMapping::from_alignment(6, 4, &alignments);
        assert_eq!(result.merged_tick_count, 8);

        assert_eq!(result.base.to_merged(0), Some(0));
        assert_eq!(result.base.to_merged(5), Some(5));
        assert_eq!(result.target.to_merged(0), Some(4));
        assert_eq!(result.target.to_merged(1), Some(5));
        assert_eq!(result.target.to_merged(2), Some(6));
        assert_eq!(result.target.to_merged(3), Some(7));

        assert_eq!(result.base.to_client(6), None);
        assert_eq!(result.base.to_client(7), None);
        assert_eq!(result.target.to_client(6), Some(2));
        assert_eq!(result.target.to_client(7), Some(3));
    }

    #[test]
    fn from_alignment_exposes_client_tick_count() {
        let alignments = vec![vec![merge(0, 0), merge(1, 1)]];

        let result = TickMapping::from_alignment(6, 3, &alignments);

        assert_eq!(result.base.client_tick_count(), 6);
        assert_eq!(result.target.client_tick_count(), 3);
    }

    // The MergeMapping tests simulate a three-client merge: A (base),
    // B (step 1), C (step 2).
    //
    // Step 1: A (5 ticks) + B (5 ticks), identity alignment.
    //
    // Step 2: merged (5 ticks) + C (5 ticks), aligned with an insert at
    // position 2.
    //   Merged ticks: 0,1,2,3,4,_
    //   C ticks:      _,0,1,2,3,4
    //   Alignment: merge(0,0), merge(1,1), insert(C:2), merge(2,3), merge(3,4)

    const CLIENT_A: ClientId = ClientId(1);
    const CLIENT_B: ClientId = ClientId(2);
    const CLIENT_C: ClientId = ClientId(3);

    fn build_step1_mappings() -> Mappings {
        Mappings {
            base: TickMapping::identity(5),
            target: TickMapping::identity(5),
            merged_tick_count: 5,
        }
    }

    fn build_step2_mappings() -> Mappings {
        let alignments = vec![vec![
            merge(0, 0),
            merge(1, 1),
            insert(2),
            merge(2, 3),
            merge(3, 4),
        ]];
        TickMapping::from_alignment(5, 5, &alignments)
    }

    #[test]
    fn resolves_the_base_client_through_the_full_chain() {
        let mut mm = MergeMapping::new(CLIENT_A);

        mm.begin(CLIENT_B, build_step1_mappings());
        mm.commit();

        mm.begin(CLIENT_C, build_step2_mappings());
        mm.commit();

        assert_eq!(mm.resolve_client_tick(0, CLIENT_A), Some(0));
        assert_eq!(mm.resolve_client_tick(3, CLIENT_A), Some(2));
        assert_eq!(mm.resolve_client_tick(5, CLIENT_A), Some(4));
    }

    #[test]
    fn resolves_a_step_one_target_through_the_chain() {
        let mut mm = MergeMapping::new(CLIENT_A);

        mm.begin(CLIENT_B, build_step1_mappings());
        mm.commit();

        mm.begin(CLIENT_C, build_step2_mappings());
        mm.commit();

        assert_eq!(mm.resolve_client_tick(0, CLIENT_B), Some(0));
        assert_eq!(mm.resolve_client_tick(3, CLIENT_B), Some(2));
        assert_eq!(mm.resolve_client_tick(5, CLIENT_B), Some(4));
    }

    #[test]
    fn resolves_the_latest_target_directly() {
        let mut mm = MergeMapping::new(CLIENT_A);

        mm.begin(CLIENT_B, build_step1_mappings());
        mm.commit();

        mm.begin(CLIENT_C, build_step2_mappings());
        mm.commit();

        assert_eq!(mm.resolve_client_tick(2, CLIENT_C), Some(2));
        assert_eq!(mm.resolve_client_tick(0, CLIENT_C), Some(0));
    }

    #[test]
    fn resolve_returns_none_for_an_unknown_client() {
        let mut mm = MergeMapping::new(CLIENT_A);
        mm.begin(CLIENT_B, build_step1_mappings());
        mm.commit();

        assert_eq!(mm.resolve_client_tick(0, ClientId(999)), None);
    }

    #[test]
    fn resolve_returns_none_when_a_tick_has_no_mapping_in_the_chain() {
        let mut mm = MergeMapping::new(CLIENT_A);

        mm.begin(CLIENT_C, build_step2_mappings());
        mm.commit();

        // Tick 2 was inserted from C; it has no mapping in the other clients.
        assert_eq!(mm.resolve_client_tick(2, CLIENT_A), None);
        assert_eq!(mm.resolve_client_tick(2, CLIENT_B), None);
        assert_eq!(mm.resolve_client_tick(2, CLIENT_C), Some(2));
    }

    #[test]
    fn in_flight_entry_participates_in_resolution_before_commit() {
        let mut mm = MergeMapping::new(CLIENT_A);

        mm.begin(CLIENT_B, build_step1_mappings());

        assert_eq!(mm.resolve_client_tick(2, CLIENT_B), Some(2));
        assert_eq!(mm.resolve_client_tick(2, CLIENT_A), Some(2));
    }

    #[test]
    fn in_flight_entry_is_cleared_by_discard() {
        let mut mm = MergeMapping::new(CLIENT_A);

        mm.begin(CLIENT_B, build_step1_mappings());
        mm.discard();

        assert_eq!(mm.resolve_client_tick(0, CLIENT_B), None);
        assert_eq!(mm.resolve_client_tick(0, CLIENT_A), Some(0));
    }

    #[test]
    fn in_flight_entry_moves_to_the_committed_chain_on_commit() {
        let mut mm = MergeMapping::new(CLIENT_A);

        mm.begin(CLIENT_B, build_step1_mappings());
        mm.commit();

        mm.begin(CLIENT_C, build_step2_mappings());

        assert_eq!(mm.resolve_client_tick(4, CLIENT_B), Some(3));
        // Tick 2 was inserted from C; it has no mapping in the other clients.
        assert_eq!(mm.resolve_client_tick(2, CLIENT_A), None);
        assert_eq!(mm.resolve_client_tick(2, CLIENT_B), None);
        assert_eq!(mm.resolve_client_tick(2, CLIENT_C), Some(2));
    }
}
