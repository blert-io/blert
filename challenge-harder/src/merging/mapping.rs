//! Mappings between different clients' tick spaces in a merge.

use super::Tick;
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
    pub fn identity(last_tick: Tick) -> Self {
        let mapping: Vec<Option<usize>> = (0..=last_tick.as_usize()).map(Some).collect();
        Self {
            forward: mapping.clone(),
            reverse: mapping,
        }
    }

    /// Builds base and target tick mappings from a list of local alignments.
    pub fn from_alignment(
        base_last_tick: Tick,
        target_last_tick: Tick,
        alignments: &[Vec<AlignmentEntry>],
    ) -> Mappings {
        let base_tick_count = base_last_tick.as_usize() + 1;
        let target_tick_count = target_last_tick.as_usize() + 1;
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
                base_index: first, ..
            } = entries[0]
            else {
                unreachable!("local alignment starts with a merge entry");
            };
            let AlignmentEntry::Merge {
                base_index: last, ..
            } = entries[entries.len() - 1]
            else {
                unreachable!("local alignment ends with a merge entry");
            };

            while base_pos < first {
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

            base_pos = last + 1;
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
        let merged_to_base = reverse_map(&base_to_merged, merged_tick_count);
        let merged_to_target = reverse_map(&target_to_merged, merged_tick_count);

        Mappings {
            base: TickMapping::new(base_to_merged, merged_to_base),
            target: TickMapping::new(target_to_merged, merged_to_target),
            merged_last_tick: Tick::from_usize(
                merged_tick_count
                    .checked_sub(1)
                    .expect("mapping is nonempty"),
            ),
        }
    }

    /// The last client tick covered by this mapping.
    pub fn client_last_tick(&self) -> Tick {
        Tick::from_usize(
            self.forward
                .len()
                .checked_sub(1)
                .expect("mapping is nonempty"),
        )
    }

    /// Maps a client tick to its merged tick.
    pub fn to_merged(&self, client_tick: Tick) -> Option<Tick> {
        self.forward
            .get(client_tick.as_usize())
            .copied()
            .flatten()
            .map(Tick::from_usize)
    }

    /// Maps a merged tick to its client tick.
    pub fn to_client(&self, merged_tick: Tick) -> Option<Tick> {
        self.reverse
            .get(merged_tick.as_usize())
            .copied()
            .flatten()
            .map(Tick::from_usize)
    }
}

fn reverse_map(fwd: &[Option<usize>], count: usize) -> Vec<Option<usize>> {
    let mut reverse = vec![None; count];
    for (client_tick, merged_tick) in fwd.iter().enumerate() {
        if let Some(merged_tick) = merged_tick {
            reverse[*merged_tick] = Some(client_tick);
        }
    }
    reverse
}

/// Tick mappings from a merge step.
#[derive(Debug)]
pub(super) struct Mappings {
    pub base: TickMapping,
    pub target: TickMapping,
    pub merged_last_tick: Tick,
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

    /// Returns the active merge step's mappings if one is in progress.
    pub fn current_step(&self) -> Option<&Mappings> {
        self.in_flight.as_ref().map(|entry| &entry.mappings)
    }

    /// Resolves a tick index in the current merged space back to a specific
    /// client's original tick space, or `None` if the tick is not mapped.
    pub fn resolve_client_tick(&self, merged: Tick, client_id: ClientId) -> Option<Tick> {
        let mut current = merged;

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
        let mapping = TickMapping::identity(Tick(4));
        for tick in Tick(4).up_to_inclusive() {
            assert_eq!(mapping.to_merged(tick), Some(tick));
            assert_eq!(mapping.to_client(tick), Some(tick));
        }
    }

    #[test]
    fn identity_returns_none_for_out_of_range_ticks() {
        let mapping = TickMapping::identity(Tick(2));
        assert_eq!(mapping.to_merged(Tick(3)), None);
        assert_eq!(mapping.to_client(Tick(3)), None);
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

        let result = TickMapping::from_alignment(Tick(4), Tick(5), &alignments);
        assert_eq!(result.merged_last_tick, Tick(5));

        assert_eq!(result.base.to_merged(Tick(0)), Some(Tick(0)));
        assert_eq!(result.base.to_merged(Tick(1)), Some(Tick(1)));
        assert_eq!(result.base.to_merged(Tick(2)), Some(Tick(3)));
        assert_eq!(result.base.to_merged(Tick(3)), Some(Tick(4)));
        assert_eq!(result.base.to_merged(Tick(4)), Some(Tick(5)));
        assert_eq!(result.base.to_merged(Tick(5)), None);

        assert_eq!(result.target.to_merged(Tick(0)), Some(Tick(0)));
        assert_eq!(result.target.to_merged(Tick(1)), Some(Tick(1)));
        assert_eq!(result.target.to_merged(Tick(2)), Some(Tick(2)));
        assert_eq!(result.target.to_merged(Tick(3)), Some(Tick(3)));
        assert_eq!(result.target.to_merged(Tick(4)), Some(Tick(4)));
        assert_eq!(result.target.to_merged(Tick(5)), Some(Tick(5)));

        assert_eq!(result.base.to_client(Tick(0)), Some(Tick(0)));
        assert_eq!(result.base.to_client(Tick(1)), Some(Tick(1)));
        assert_eq!(result.base.to_client(Tick(2)), None);
        assert_eq!(result.base.to_client(Tick(3)), Some(Tick(2)));
        assert_eq!(result.base.to_client(Tick(4)), Some(Tick(3)));
        assert_eq!(result.base.to_client(Tick(5)), Some(Tick(4)));
    }

    #[test]
    fn from_alignment_maps_ticks_with_a_keep() {
        // base:   0,1,2,3
        // target: 0,_,1,2
        let alignments = vec![vec![merge(0, 0), keep(1), merge(2, 1), merge(3, 2)]];

        let result = TickMapping::from_alignment(Tick(3), Tick(2), &alignments);
        assert_eq!(result.merged_last_tick, Tick(3));

        assert_eq!(result.base.to_merged(Tick(0)), Some(Tick(0)));
        assert_eq!(result.base.to_merged(Tick(1)), Some(Tick(1)));
        assert_eq!(result.base.to_merged(Tick(2)), Some(Tick(2)));
        assert_eq!(result.base.to_merged(Tick(3)), Some(Tick(3)));

        assert_eq!(result.target.to_merged(Tick(0)), Some(Tick(0)));
        assert_eq!(result.target.to_merged(Tick(1)), Some(Tick(2)));
        assert_eq!(result.target.to_merged(Tick(2)), Some(Tick(3)));

        assert_eq!(result.target.to_client(Tick(1)), None);
    }

    #[test]
    fn from_alignment_includes_base_ticks_before_and_after_the_alignment() {
        // base:   0,1,2,3,4,5
        // target: _,_,0,1,_,_
        let alignments = vec![vec![merge(2, 0), merge(3, 1)]];

        let result = TickMapping::from_alignment(Tick(5), Tick(1), &alignments);
        assert_eq!(result.merged_last_tick, Tick(5));

        assert_eq!(result.base.to_merged(Tick(0)), Some(Tick(0)));
        assert_eq!(result.base.to_merged(Tick(1)), Some(Tick(1)));
        assert_eq!(result.base.to_merged(Tick(2)), Some(Tick(2)));
        assert_eq!(result.base.to_merged(Tick(3)), Some(Tick(3)));
        assert_eq!(result.base.to_merged(Tick(4)), Some(Tick(4)));
        assert_eq!(result.base.to_merged(Tick(5)), Some(Tick(5)));

        assert_eq!(result.target.to_merged(Tick(0)), Some(Tick(2)));
        assert_eq!(result.target.to_merged(Tick(1)), Some(Tick(3)));
    }

    #[test]
    fn from_alignment_prepends_leading_target_ticks_when_base_starts_at_the_first_merge() {
        // base:   _,_,0,1,2,3,4,5
        // target: 0,1,2,3,_,_,_,_
        let alignments = vec![vec![merge(0, 2), merge(1, 3)]];

        let result = TickMapping::from_alignment(Tick(5), Tick(3), &alignments);
        assert_eq!(result.merged_last_tick, Tick(7));

        assert_eq!(result.target.to_merged(Tick(0)), Some(Tick(0)));
        assert_eq!(result.target.to_merged(Tick(1)), Some(Tick(1)));
        assert_eq!(result.target.to_merged(Tick(2)), Some(Tick(2)));
        assert_eq!(result.target.to_merged(Tick(3)), Some(Tick(3)));
        assert_eq!(result.base.to_merged(Tick(0)), Some(Tick(2)));
        assert_eq!(result.base.to_merged(Tick(1)), Some(Tick(3)));
        assert_eq!(result.base.to_merged(Tick(5)), Some(Tick(7)));

        assert_eq!(result.base.to_client(Tick(0)), None);
        assert_eq!(result.base.to_client(Tick(1)), None);
        assert_eq!(result.target.to_client(Tick(0)), Some(Tick(0)));
        assert_eq!(result.target.to_client(Tick(1)), Some(Tick(1)));
    }

    #[test]
    fn from_alignment_appends_trailing_target_ticks_when_base_ends_at_the_last_merge() {
        // base:   0,1,2,3,4,5,_,_
        // target: _,_,_,_,0,1,2,3
        let alignments = vec![vec![merge(4, 0), merge(5, 1)]];

        let result = TickMapping::from_alignment(Tick(5), Tick(3), &alignments);
        assert_eq!(result.merged_last_tick, Tick(7));

        assert_eq!(result.base.to_merged(Tick(0)), Some(Tick(0)));
        assert_eq!(result.base.to_merged(Tick(5)), Some(Tick(5)));
        assert_eq!(result.target.to_merged(Tick(0)), Some(Tick(4)));
        assert_eq!(result.target.to_merged(Tick(1)), Some(Tick(5)));
        assert_eq!(result.target.to_merged(Tick(2)), Some(Tick(6)));
        assert_eq!(result.target.to_merged(Tick(3)), Some(Tick(7)));

        assert_eq!(result.base.to_client(Tick(6)), None);
        assert_eq!(result.base.to_client(Tick(7)), None);
        assert_eq!(result.target.to_client(Tick(6)), Some(Tick(2)));
        assert_eq!(result.target.to_client(Tick(7)), Some(Tick(3)));
    }

    #[test]
    fn from_alignment_exposes_client_duration() {
        let alignments = vec![vec![merge(0, 0), merge(1, 1)]];

        let result = TickMapping::from_alignment(Tick(6), Tick(3), &alignments);

        assert_eq!(result.base.client_last_tick(), Tick(6));
        assert_eq!(result.target.client_last_tick(), Tick(3));
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
            base: TickMapping::identity(Tick(4)),
            target: TickMapping::identity(Tick(4)),
            merged_last_tick: Tick(4),
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
        TickMapping::from_alignment(Tick(4), Tick(4), &alignments)
    }

    #[test]
    fn resolves_the_base_client_through_the_full_chain() {
        let mut mm = MergeMapping::new(CLIENT_A);

        mm.begin(CLIENT_B, build_step1_mappings());
        mm.commit();

        mm.begin(CLIENT_C, build_step2_mappings());
        mm.commit();

        assert_eq!(mm.resolve_client_tick(Tick(0), CLIENT_A), Some(Tick(0)));
        assert_eq!(mm.resolve_client_tick(Tick(3), CLIENT_A), Some(Tick(2)));
        assert_eq!(mm.resolve_client_tick(Tick(5), CLIENT_A), Some(Tick(4)));
    }

    #[test]
    fn resolves_a_step_one_target_through_the_chain() {
        let mut mm = MergeMapping::new(CLIENT_A);

        mm.begin(CLIENT_B, build_step1_mappings());
        mm.commit();

        mm.begin(CLIENT_C, build_step2_mappings());
        mm.commit();

        assert_eq!(mm.resolve_client_tick(Tick(0), CLIENT_B), Some(Tick(0)));
        assert_eq!(mm.resolve_client_tick(Tick(3), CLIENT_B), Some(Tick(2)));
        assert_eq!(mm.resolve_client_tick(Tick(5), CLIENT_B), Some(Tick(4)));
    }

    #[test]
    fn resolves_the_latest_target_directly() {
        let mut mm = MergeMapping::new(CLIENT_A);

        mm.begin(CLIENT_B, build_step1_mappings());
        mm.commit();

        mm.begin(CLIENT_C, build_step2_mappings());
        mm.commit();

        assert_eq!(mm.resolve_client_tick(Tick(2), CLIENT_C), Some(Tick(2)));
        assert_eq!(mm.resolve_client_tick(Tick(0), CLIENT_C), Some(Tick(0)));
    }

    #[test]
    fn resolve_returns_none_for_an_unknown_client() {
        let mut mm = MergeMapping::new(CLIENT_A);
        mm.begin(CLIENT_B, build_step1_mappings());
        mm.commit();

        assert_eq!(mm.resolve_client_tick(Tick(0), ClientId(999)), None);
    }

    #[test]
    fn resolve_returns_none_when_a_tick_has_no_mapping_in_the_chain() {
        let mut mm = MergeMapping::new(CLIENT_A);

        mm.begin(CLIENT_C, build_step2_mappings());
        mm.commit();

        // Tick 2 was inserted from C; it has no mapping in the other clients.
        assert_eq!(mm.resolve_client_tick(Tick(2), CLIENT_A), None);
        assert_eq!(mm.resolve_client_tick(Tick(2), CLIENT_B), None);
        assert_eq!(mm.resolve_client_tick(Tick(2), CLIENT_C), Some(Tick(2)));
    }

    #[test]
    fn in_flight_entry_participates_in_resolution_before_commit() {
        let mut mm = MergeMapping::new(CLIENT_A);

        mm.begin(CLIENT_B, build_step1_mappings());

        assert_eq!(mm.resolve_client_tick(Tick(2), CLIENT_B), Some(Tick(2)));
        assert_eq!(mm.resolve_client_tick(Tick(2), CLIENT_A), Some(Tick(2)));
    }

    #[test]
    fn in_flight_entry_is_cleared_by_discard() {
        let mut mm = MergeMapping::new(CLIENT_A);

        mm.begin(CLIENT_B, build_step1_mappings());
        mm.discard();

        assert_eq!(mm.resolve_client_tick(Tick(0), CLIENT_B), None);
        assert_eq!(mm.resolve_client_tick(Tick(0), CLIENT_A), Some(Tick(0)));
    }

    #[test]
    fn in_flight_entry_moves_to_the_committed_chain_on_commit() {
        let mut mm = MergeMapping::new(CLIENT_A);

        mm.begin(CLIENT_B, build_step1_mappings());
        mm.commit();

        mm.begin(CLIENT_C, build_step2_mappings());

        assert_eq!(mm.resolve_client_tick(Tick(4), CLIENT_B), Some(Tick(3)));
        // Tick 2 was inserted from C; it has no mapping in the other clients.
        assert_eq!(mm.resolve_client_tick(Tick(2), CLIENT_A), None);
        assert_eq!(mm.resolve_client_tick(Tick(2), CLIENT_B), None);
        assert_eq!(mm.resolve_client_tick(Tick(2), CLIENT_C), Some(Tick(2)));
    }
}
