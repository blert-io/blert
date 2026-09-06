//! Confidence scoring for a merge step.
#![expect(dead_code)]

use super::Tick;
use super::alignment::{AlignmentEntry, AlignmentRange, AlignmentResult, LocalAlignment};
use super::consolidator::{Disagreement, QualityFlag, ReconciliationCounters};

#[derive(Debug, Clone, PartialEq)]
pub struct SegmentConfidence {
    /// Start of the segment region.
    pub base_start: usize,
    /// Exclusive end of the segment region.
    pub base_end: usize,
    /// Reciprocal of the number of potential compatible paths the segment's
    /// alignment could have taken.
    pub discriminability: f64,
    /// Decisiveness of the chosen alignment relative to the best alternative.
    pub bonus_support: f64,
    /// Overall score combining discriminability and bonus support.
    pub score: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StructuralConfidence {
    /// Axis value in [0, 1].
    pub value: f64,
    /// True if the step was identity mapped, resulting in a value of 1.
    pub identity: bool,
    /// Fraction of target ticks placed across all local alignments.
    pub target_coverage: f64,
    /// Score breakdown of every ambiguous segment within the alignment.
    pub segments: Vec<SegmentConfidence>,
    /// Index of the lowest scoring segment.
    pub worst_segment_idx: Option<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ContentConfidence {
    /// Axis value in [0, 1].
    pub value: f64,
    /// Fraction of player and NPC attacks/spells that conflicted between clients.
    pub disagreement_rate: f64,
    /// Fraction of paired stream events that had an abnormally large gap between
    /// the base and target ticks.
    pub large_gap_rate: f64,
    /// Fraction of attack-mapped events that failed to map to an attack.
    pub attack_mapped_failure_rate: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StepConfidence {
    /// Combined score in [0, 1].
    pub overall: f64,
    pub structural: StructuralConfidence,
    pub content: ContentConfidence,
}

impl StepConfidence {
    pub(super) fn check(self, threshold: f64) -> Result<Self, Self> {
        if self.overall < threshold {
            Err(self)
        } else {
            Ok(self)
        }
    }

    pub fn worst_segment_score(&self) -> Option<f64> {
        self.structural
            .worst_segment_idx
            .map(|idx| self.structural.segments[idx].score)
    }
}

/// Tunable parameters for merge step confidence scoring.
#[derive(Debug, Clone)]
pub(super) struct ConfidenceWeights {
    /// Weight of the structural axis in the overall score.
    pub axis: f64,
    /// Margin scale for bonus support. A per-step margin of this size maps to
    /// roughly 63% support via `1 - exp(-margin / support_scale)`. On the order
    /// of the alignment's gap penalty, since geometry alone yields margins of
    /// about that size.
    pub support_scale: f64,
    /// Softmin temperature for combining per-step support across a segment.
    /// Lower values approach a hard minimum where one weak step dominates.
    pub support_temperature: f64,
    pub disagreement: f64,
    pub large_gap: f64,
    pub attack_mapped_failure: f64,
}

impl Default for ConfidenceWeights {
    fn default() -> Self {
        Self {
            axis: 0.5,
            support_scale: 5.0,
            support_temperature: 0.1,
            disagreement: 0.6,
            large_gap: 0.2,
            attack_mapped_failure: 0.2,
        }
    }
}

/// A segment represents an ambiguous compatible run of actions within a local
/// alignment. In simple terms, it is a region of the alignment where tick
/// compatibility alone did not force a path, and similarity scoring had to
/// come into play to choose between alternatives.
#[derive(Debug, PartialEq)]
struct Segment<'a> {
    /// The ambiguous merges and interleaved gaps, trimmed to first/last merge.
    entries: &'a [AlignmentEntry],
    /// The tick range bounding the segment.
    region: AlignmentRange,
}

#[derive(Debug, PartialEq)]
enum AlignmentPartition<'a> {
    Anchor {
        base_index: usize,
        target_index: usize,
    },
    Segment(Segment<'a>),
}

struct Plateau {
    base_index: usize,
    target_index: usize,
    lo: usize,
    hi: usize,
}

impl Plateau {
    fn width(&self) -> usize {
        self.hi - self.lo + 1
    }
}

fn is_null_merge(la: &LocalAlignment, base_index: usize, target_index: usize) -> bool {
    la.base_null.contains(&base_index) || la.target_null.contains(&target_index)
}

/// Lower and upper bounds of the contiguous run of compatible cells in row
/// `base` around column `target`, i.e. how far the merge could drift in the
/// target direction before compatibility breaks.
fn plateau_bounds(la: &LocalAlignment, base: usize, target: usize) -> (usize, usize) {
    let AlignmentRange {
        target_start,
        target_end,
        ..
    } = la.range;
    // Null target columns are "compatible" only because a null scores 0;
    // they are not real alternatives, so they don't widen the plateau.
    let compatible =
        |col: usize| la.similarity(base, col).is_finite() && !la.target_null.contains(&col);
    let mut lo = target;
    let mut hi = target;
    while lo > target_start && compatible(lo - 1) {
        lo -= 1;
    }
    while hi < target_end - 1 && compatible(hi + 1) {
        hi += 1;
    }
    (lo, hi)
}

fn flush_pending<'a>(
    la: &'a LocalAlignment,
    plateaus: &[Option<Plateau>],
    pending: &[usize],
    left_anchor: Option<&Plateau>,
    right_anchor: Option<&Plateau>,
) -> Option<Segment<'a>> {
    // The pending run forms a segment only if it contains an ambiguous merge.
    // Trim to the span between the first and last ambiguous merge; gaps outside
    // that span are pinned by the surrounding anchors.
    let mut ambiguous = pending.iter().filter_map(|&idx| {
        plateaus[idx]
            .as_ref()
            .filter(|plateau| plateau.width() > 1)
            .map(|plateau| (idx, plateau))
    });
    let (first, first_merge) = ambiguous.next()?;
    let (last, last_merge) = ambiguous.next_back().unwrap_or((first, first_merge));
    // An unpinned (edge) side is bounded by the segment's own merges rather
    // than the search range. Base uses its matched extent, target uses the
    // union of its plateaus.
    let (t_lo, t_hi) = plateaus[first..=last]
        .iter()
        .flatten()
        .fold((usize::MAX, 0), |(lo, hi), plateau| {
            (lo.min(plateau.lo), hi.max(plateau.hi))
        });
    let region = AlignmentRange {
        base_start: left_anchor.map_or(first_merge.base_index, |anchor| anchor.base_index + 1),
        base_end: right_anchor.map_or(last_merge.base_index + 1, |anchor| anchor.base_index),
        target_start: left_anchor.map_or(t_lo, |anchor| anchor.target_index + 1),
        target_end: right_anchor.map_or(t_hi + 1, |anchor| anchor.target_index),
    };
    Some(Segment {
        entries: &la.entries[first..=last],
        region,
    })
}

/// Partitions a local alignment into anchors and segments.
///
/// An anchor is a MERGE whose base tick is compatible with exactly one adjacent
/// target tick (plateau 1): its world state forced a match. A segment is a run
/// of ambiguous merges (plateau > 1) together with any gaps interleaved between
/// them.
///
/// Gaps that are not interleaved between ambiguous merges (between two anchors,
/// or leading/trailing a segment) are pinned by their surrounding anchors and
/// have no structural uncertainty, so they are not emitted.
fn partition_alignment(la: &LocalAlignment) -> Vec<AlignmentPartition<'_>> {
    let plateaus: Vec<Option<Plateau>> = la
        .entries
        .iter()
        .map(|entry| match *entry {
            // A null merge is left unclassified so it falls through as a gap.
            AlignmentEntry::Merge {
                base_index,
                target_index,
                ..
            } if !is_null_merge(la, base_index, target_index) => {
                let (lo, hi) = plateau_bounds(la, base_index, target_index);
                Some(Plateau {
                    base_index,
                    target_index,
                    lo,
                    hi,
                })
            }
            _ => None,
        })
        .collect();

    let mut partitions = Vec::new();

    // Entry indices accumulated since the last anchor, pending classification.
    let mut pending = Vec::new();

    let mut prev_anchor = None;
    for (idx, plateau) in plateaus.iter().enumerate() {
        match plateau {
            Some(anchor) if anchor.width() == 1 => {
                if let Some(segment) =
                    flush_pending(la, &plateaus, &pending, prev_anchor, Some(anchor))
                {
                    partitions.push(AlignmentPartition::Segment(segment));
                }
                pending.clear();
                partitions.push(AlignmentPartition::Anchor {
                    base_index: anchor.base_index,
                    target_index: anchor.target_index,
                });
                prev_anchor = Some(anchor);
            }
            _ => pending.push(idx),
        }
    }

    if let Some(segment) = flush_pending(la, &plateaus, &pending, prev_anchor, None) {
        partitions.push(AlignmentPartition::Segment(segment));
    }
    partitions
}

/// Region size (non-null base ticks x target ticks) above which the exact path
/// count is replaced by a closed-form estimate.
/// The exact DP is `O(cells^2 * merge_count)`, so this avoids degenerate cases
/// like a large region where every tick is compatible wasting time computing a
/// value that's effectively 0 or 1.
const MAX_EXACT_REGION: u64 = 1024;

const MAX_PATH_COUNT: u32 = 1_000_000_000;

/// Counts the monotone matchings of exactly length `size` among `cells`, where
/// a matching is a subsequence strictly increasing in both row and column, i.e.
/// the number of distinct order-preserving ways `size` pairs could be drawn.
fn count_monotone_matchings(cells: &[(usize, usize)], size: usize) -> u32 {
    if size == 0 {
        return 1;
    }

    // Sort by (row, col) so every valid predecessor of a cell appears before it.
    let mut sorted = cells.to_vec();
    sorted.sort_unstable();
    let n = sorted.len();

    let width = size + 1;

    // `dp[i * width + s]` = number of size `s` matchings ending at `sorted[i]`.
    let mut dp = vec![0; n * width];

    let mut total = 0;
    for (i, &(row_i, col_i)) in sorted.iter().enumerate() {
        let offset_i = i * width;
        dp[offset_i + 1] = 1;

        for (j, &(row_j, col_j)) in sorted[..i].iter().enumerate() {
            if row_j < row_i && col_j < col_i {
                let offset_j = j * width;

                for s in 2..=size {
                    dp[offset_i + s] =
                        (dp[offset_i + s] + dp[offset_j + s - 1]).min(MAX_PATH_COUNT);
                }
            }
        }
        total = (total + dp[offset_i + size]).min(MAX_PATH_COUNT);
    }
    total
}

/// `C(n, k)`, clamped at `MAX_PATH_COUNT`.
fn bounded_binomial(n: u32, k: u32) -> f64 {
    if k > n {
        return 0.0;
    }
    let kk = k.min(n - k);
    let mut result = 1.0;
    for i in 0..kk {
        result = (result * f64::from(n - i)) / f64::from(i + 1);
        if result > f64::from(MAX_PATH_COUNT) {
            return f64::from(MAX_PATH_COUNT);
        }
    }
    result
}

/// Computes the "geometric freedom" of a segment within an alignment: the
/// reciprocal of the number of distinct monotone paths its merges could
/// have taken through its compatible cells.
///
/// Null cells are excluded from the region.
///
/// If no paths exist, returns a discriminability of 1.
fn segment_discriminability(la: &LocalAlignment, segment: &Segment<'_>) -> f64 {
    let mut merge_count: u32 = 0;
    for entry in segment.entries {
        if let AlignmentEntry::Merge {
            base_index,
            target_index,
            ..
        } = *entry
            && !is_null_merge(la, base_index, target_index)
        {
            merge_count += 1;
        }
    }

    let mut non_null_base: u32 = 0;
    for b in segment.region.base_start..segment.region.base_end {
        if !la.base_null.contains(&b) {
            non_null_base += 1;
        }
    }
    let mut non_null_target: u32 = 0;
    for t in segment.region.target_start..segment.region.target_end {
        if !la.target_null.contains(&t) {
            non_null_target += 1;
        }
    }

    // If the region is too large, skip the DP and use a closed-form estimate.
    if u64::from(non_null_base) * u64::from(non_null_target) > MAX_EXACT_REGION {
        let paths = bounded_binomial(non_null_base, merge_count)
            * bounded_binomial(non_null_target, merge_count);
        return if paths <= 1.0 { 1.0 } else { 1.0 / paths };
    }

    let mut cells = Vec::new();
    for b in segment.region.base_start..segment.region.base_end {
        if la.base_null.contains(&b) {
            continue;
        }
        for t in segment.region.target_start..segment.region.target_end {
            if la.target_null.contains(&t) {
                continue;
            }
            if la.similarity(b, t).is_finite() {
                cells.push((b, t));
            }
        }
    }

    let paths = count_monotone_matchings(&cells, merge_count as usize);
    if paths <= 1 {
        1.0
    } else {
        1.0 / f64::from(paths)
    }
}

/// Computes the `bonus_support` value for a segment, which measures how strongly
/// each chosen alignment action was preferred.
///
/// Scales each alignment action's precomputed margin by
/// `1 - exp(-margin / support_scale)` to get a support value.
/// The segment's bonus support is a softmin over those values.
fn segment_bonus_support(
    la: &LocalAlignment,
    segment: &Segment<'_>,
    support_scale: f64,
    temperature: f64,
    baseline_merge_weight: f64,
) -> f64 {
    let mut supports = Vec::new();

    // Map each action back to its base/target cells.
    // Segments always begin with a MERGE so the initial indices are always valid.
    let mut cur_base = 0;
    let mut cur_target = 0;
    for entry in segment.entries {
        let (is_merge, null_merge) = match *entry {
            AlignmentEntry::Merge {
                base_index,
                target_index,
                ..
            } => {
                cur_base = base_index;
                cur_target = target_index;
                (true, is_null_merge(la, base_index, target_index))
            }
            AlignmentEntry::Keep { base_index } => {
                cur_base = base_index;
                (false, false)
            }
            AlignmentEntry::Insert { target_index } => {
                cur_target = target_index;
                (false, false)
            }
        };

        // A null merge occupies a cell but isn't real evidence; skip it.
        if null_merge {
            continue;
        }

        let mut margin = la.margin(cur_base, cur_target);

        // A merge cell's margin includes the flat compatibility baseline the
        // similarity scorer adds to every shared-actor match. That reward is
        // uniform and non-discriminative, so remove it before measuring how
        // decisively the path was chosen.
        if is_merge {
            margin = (margin - baseline_merge_weight).max(0.0);
        }

        supports.push(1.0 - (-margin / support_scale).exp());
    }

    soft_min(&supports, temperature)
}

fn content_confidence(
    counters: &ReconciliationCounters,
    quality_flags: &[QualityFlag],
    weights: &ConfidenceWeights,
) -> ContentConfidence {
    let mut mismatches: u32 = 0;
    let mut large_gaps: u32 = 0;
    let mut attack_mapped_failures: u32 = 0;

    for flag in quality_flags {
        match flag {
            QualityFlag::Disagreement {
                subject: Disagreement::AttackMapped { .. },
                ..
            }
            | QualityFlag::AttackMappedNotFound { .. } => attack_mapped_failures += 1,
            QualityFlag::Disagreement { .. } => mismatches += 1,
            QualityFlag::LargeTemporalGap { .. } => large_gaps += 1,
            QualityFlag::UnmappedCrossTickReference { .. } => {}
        }
    }

    let attempts =
        counters.player_attack_pairs + counters.player_spell_pairs + counters.npc_attack_pairs;
    let disagreement_rate = safe_div(f64::from(mismatches), attempts);
    let large_gap_rate = safe_div(f64::from(large_gaps), counters.stream_event_pairs);
    let attack_mapped_failure_rate = safe_div(
        f64::from(attack_mapped_failures),
        counters.attack_mapped_events,
    );

    let penalty = (weights.disagreement * disagreement_rate
        + weights.large_gap * large_gap_rate
        + weights.attack_mapped_failure * attack_mapped_failure_rate)
        .clamp(0.0, 1.0);

    ContentConfidence {
        value: 1.0 - penalty,
        disagreement_rate,
        large_gap_rate,
        attack_mapped_failure_rate,
    }
}

fn structural_confidence(
    alignment: Option<&AlignmentResult>,
    weights: &ConfidenceWeights,
    baseline_merge_weight: f64,
) -> StructuralConfidence {
    let Some(alignment) = alignment else {
        return StructuralConfidence {
            value: 1.0,
            identity: true,
            target_coverage: 1.0,
            segments: Vec::new(),
            worst_segment_idx: None,
        };
    };

    let mut segments = Vec::new();
    let mut weighted_quality_sum = 0.0;
    let mut total_merge_count: u32 = 0;

    for la in &alignment.alignments {
        let mut quality_num = 0.0;
        let mut quality_den: u32 = 0;
        for part in partition_alignment(la) {
            let segment = match part {
                AlignmentPartition::Anchor { .. } => {
                    quality_num += 1.0;
                    quality_den += 1;
                    continue;
                }
                AlignmentPartition::Segment(segment) => segment,
            };

            let discriminability = segment_discriminability(la, &segment);
            let bonus_support = segment_bonus_support(
                la,
                &segment,
                weights.support_scale,
                weights.support_temperature,
                baseline_merge_weight,
            );
            let score = noisy_or(discriminability, bonus_support);

            let base_span = Tick::from_usize(segment.region.base_end)
                - Tick::from_usize(segment.region.base_start);
            quality_num += score * f64::from(base_span.0);
            quality_den += base_span.0;

            segments.push(SegmentConfidence {
                base_start: segment.region.base_start,
                base_end: segment.region.base_end,
                discriminability,
                bonus_support,
                score,
            });
        }

        if quality_den == 0 {
            continue;
        }

        let mut merge_count: u32 = 0;
        for entry in &la.entries {
            if matches!(entry, AlignmentEntry::Merge { .. }) {
                merge_count += 1;
            }
        }

        // Larger alignments contribute more to the cross-alignment mean.
        let quality = quality_num / f64::from(quality_den);
        weighted_quality_sum += quality * f64::from(merge_count);
        total_merge_count += merge_count;
    }

    let weighted_quality = safe_div(weighted_quality_sum, total_merge_count);
    let value = weighted_quality * alignment.target_coverage;

    let mut worst_segment_idx = None;
    for (i, segment) in segments.iter().enumerate() {
        if worst_segment_idx.is_none_or(|worst: usize| segment.score < segments[worst].score) {
            worst_segment_idx = Some(i);
        }
    }

    StructuralConfidence {
        value,
        identity: false,
        target_coverage: alignment.target_coverage,
        segments,
        worst_segment_idx,
    }
}

pub(super) fn score_step_confidence(
    alignment: Option<&AlignmentResult>,
    counters: &ReconciliationCounters,
    quality_flags: &[QualityFlag],
    weights: &ConfidenceWeights,
    baseline_merge_weight: f64,
) -> StepConfidence {
    let content = content_confidence(counters, quality_flags, weights);
    let structural = structural_confidence(alignment, weights, baseline_merge_weight);

    let overall = weights.axis * structural.value + (1.0 - weights.axis) * content.value;

    StepConfidence {
        overall,
        structural,
        content,
    }
}

fn safe_div(numerator: f64, denominator: u32) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        numerator / f64::from(denominator)
    }
}

fn soft_min(values: &[f64], temperature: f64) -> f64 {
    if values.is_empty() {
        return 1.0;
    }
    let (sum, count) = values.iter().fold((0.0, 0.0), |(sum, count), value| {
        (sum + (-value / temperature).exp(), count + 1.0)
    });
    -temperature * (sum / count).ln()
}

fn noisy_or(a: f64, b: f64) -> f64 {
    1.0 - (1.0 - a) * (1.0 - b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::types::{ClientId, Stage};
    use crate::merging::alignment::{AlignmentConfig, TickAligner};
    use crate::merging::fixtures;
    use crate::merging::timeline::TickState;
    use crate::proto::PlayerAttack;

    const STAGE: Stage = Stage::TobMaiden;

    fn tick_states(len: usize, nulls: &[usize]) -> Vec<Option<TickState>> {
        let party = vec!["1Ogp".to_string()];
        let events = (0..len)
            .map(|t| {
                fixtures::PlayerUpdateEvent::new(Tick::from_usize(t), STAGE, "1Ogp", (10, 20))
                    .build()
            })
            .collect();
        let timeline = fixtures::timeline(&party, Tick::from_usize(len - 1), events);
        (0..len)
            .map(|t| {
                (!nulls.contains(&t)).then(|| {
                    timeline
                        .get(Tick::from_usize(t))
                        .expect("tick has recorded state")
                        .clone()
                })
            })
            .collect()
    }

    // `matrix[i][j]` scores base tick `i` against target tick `j`, so this
    // only works on timelines where tick numbers equal array indices.
    fn matrix_scorer(matrix: Vec<Vec<f64>>) -> impl Fn(&TickState, &TickState) -> f64 {
        move |a, b| {
            matrix
                .get(a.tick().as_usize())
                .and_then(|row| row.get(b.tick().as_usize()))
                .copied()
                .unwrap_or(0.0)
        }
    }

    fn similarity(rows: usize, cols: usize, cells: &[(usize, usize, f64)]) -> Vec<Vec<f64>> {
        let mut matrix = vec![vec![f64::NEG_INFINITY; cols]; rows];
        for &(row, col, score) in cells {
            matrix[row][col] = score;
        }
        matrix
    }

    fn align(
        matrix: Vec<Vec<f64>>,
        null_base: &[usize],
        null_target: &[usize],
        config: AlignmentConfig,
    ) -> AlignmentResult {
        let base = tick_states(matrix.len(), null_base);
        let target = tick_states(matrix[0].len(), null_target);
        TickAligner::with_config(&base, &target, matrix_scorer(matrix), config).align()
    }

    fn merge(base_index: usize, target_index: usize, score: f64) -> AlignmentEntry {
        AlignmentEntry::Merge {
            base_index,
            target_index,
            score,
        }
    }

    fn keep(base_index: usize) -> AlignmentEntry {
        AlignmentEntry::Keep { base_index }
    }

    #[test]
    fn partition_classifies_all_merges_as_anchors_when_every_tick_has_plateau_of_1() {
        let alignment = align(
            similarity(3, 3, &[(0, 0, 10.0), (1, 1, 10.0), (2, 2, 10.0)]),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);

        assert_eq!(
            partition_alignment(&alignment.alignments[0]),
            vec![
                AlignmentPartition::Anchor {
                    base_index: 0,
                    target_index: 0,
                },
                AlignmentPartition::Anchor {
                    base_index: 1,
                    target_index: 1,
                },
                AlignmentPartition::Anchor {
                    base_index: 2,
                    target_index: 2,
                },
            ]
        );
    }

    #[test]
    fn partition_groups_a_run_of_ambiguous_merges_into_a_single_segment() {
        let alignment = align(
            similarity(
                3,
                4,
                &[
                    (0, 0, 3.0),
                    (0, 1, 3.0),
                    (1, 1, 3.0),
                    (1, 2, 3.0),
                    (2, 2, 3.0),
                    (2, 3, 3.0),
                ],
            ),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);

        assert_eq!(
            partition_alignment(&alignment.alignments[0]),
            vec![AlignmentPartition::Segment(Segment {
                entries: &[merge(0, 0, 3.0), merge(1, 1, 3.0), merge(2, 2, 3.0)],
                region: AlignmentRange {
                    base_start: 0,
                    base_end: 3,
                    target_start: 0,
                    target_end: 4,
                },
            })]
        );
    }

    #[test]
    fn partition_splits_anchors_and_a_segment_in_a_mixed_alignment() {
        let alignment = align(
            similarity(
                5,
                5,
                &[
                    (0, 0, 10.0),
                    (1, 1, 10.0),
                    (2, 2, 3.0),
                    (2, 3, 3.0),
                    (3, 2, 3.0),
                    (3, 3, 3.0),
                    (4, 4, 10.0),
                ],
            ),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);

        assert_eq!(
            partition_alignment(&alignment.alignments[0]),
            vec![
                AlignmentPartition::Anchor {
                    base_index: 0,
                    target_index: 0,
                },
                AlignmentPartition::Anchor {
                    base_index: 1,
                    target_index: 1,
                },
                AlignmentPartition::Segment(Segment {
                    entries: &[merge(2, 2, 3.0), merge(3, 3, 3.0)],
                    region: AlignmentRange {
                        base_start: 2,
                        base_end: 4,
                        target_start: 2,
                        target_end: 4,
                    },
                }),
                AlignmentPartition::Anchor {
                    base_index: 4,
                    target_index: 4,
                },
            ]
        );
    }

    #[test]
    fn partition_splits_a_local_alignment_whose_range_starts_past_zero() {
        let alignment = align(
            similarity(
                10,
                10,
                &[
                    (0, 0, 10.0),
                    (1, 1, 10.0),
                    (2, 2, 10.0),
                    (6, 6, 10.0),
                    (7, 7, 3.0),
                    (7, 8, 3.0),
                    (8, 8, 3.0),
                    (8, 9, 3.0),
                    (9, 9, 10.0),
                ],
            ),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 2);
        let la = &alignment.alignments[1];
        assert_eq!(
            la.range,
            AlignmentRange {
                base_start: 3,
                base_end: 10,
                target_start: 3,
                target_end: 10,
            }
        );

        assert_eq!(
            partition_alignment(la),
            vec![
                AlignmentPartition::Anchor {
                    base_index: 6,
                    target_index: 6,
                },
                AlignmentPartition::Segment(Segment {
                    entries: &[merge(7, 7, 3.0), merge(8, 8, 3.0)],
                    region: AlignmentRange {
                        base_start: 7,
                        base_end: 9,
                        target_start: 7,
                        target_end: 9,
                    },
                }),
                AlignmentPartition::Anchor {
                    base_index: 9,
                    target_index: 9,
                },
            ]
        );
    }

    #[test]
    fn partition_includes_a_gap_interleaved_between_two_ambiguous_merges() {
        let alignment = align(
            similarity(
                3,
                3,
                &[(0, 0, 10.0), (0, 1, 10.0), (2, 1, 10.0), (2, 2, 10.0)],
            ),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);

        assert_eq!(
            partition_alignment(&alignment.alignments[0]),
            vec![AlignmentPartition::Segment(Segment {
                entries: &[merge(0, 0, 10.0), keep(1), merge(2, 1, 10.0)],
                region: AlignmentRange {
                    base_start: 0,
                    base_end: 3,
                    target_start: 0,
                    target_end: 3,
                },
            })]
        );
    }

    #[test]
    fn partition_drops_a_gap_pinned_between_two_anchors() {
        let alignment = align(
            similarity(3, 2, &[(0, 0, 10.0), (2, 1, 10.0)]),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);
        assert_eq!(
            alignment.alignments[0].entries,
            vec![merge(0, 0, 10.0), keep(1), merge(2, 1, 10.0)]
        );

        assert_eq!(
            partition_alignment(&alignment.alignments[0]),
            vec![
                AlignmentPartition::Anchor {
                    base_index: 0,
                    target_index: 0,
                },
                AlignmentPartition::Anchor {
                    base_index: 2,
                    target_index: 1,
                },
            ]
        );
    }

    #[test]
    fn trims_leading_and_trailing_gaps_from_a_segment() {
        let alignment = align(
            similarity(
                6,
                4,
                &[
                    (0, 0, 10.0),
                    (2, 1, 3.0),
                    (2, 2, 3.0),
                    (3, 1, 3.0),
                    (3, 2, 3.0),
                    (5, 3, 10.0),
                ],
            ),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);
        assert_eq!(
            alignment.alignments[0].entries,
            vec![
                merge(0, 0, 10.0),
                keep(1),
                merge(2, 1, 3.0),
                merge(3, 2, 3.0),
                keep(4),
                merge(5, 3, 10.0),
            ]
        );

        assert_eq!(
            partition_alignment(&alignment.alignments[0]),
            vec![
                AlignmentPartition::Anchor {
                    base_index: 0,
                    target_index: 0,
                },
                AlignmentPartition::Segment(Segment {
                    entries: &[merge(2, 1, 3.0), merge(3, 2, 3.0)],
                    region: AlignmentRange {
                        base_start: 1,
                        base_end: 5,
                        target_start: 1,
                        target_end: 3,
                    },
                }),
                AlignmentPartition::Anchor {
                    base_index: 5,
                    target_index: 3,
                },
            ]
        );
    }

    #[test]
    fn partition_treats_a_null_merge_as_a_gap() {
        let alignment = align(
            similarity(3, 3, &[(0, 0, 10.0), (2, 2, 10.0)]),
            &[1],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);
        assert_eq!(
            alignment.alignments[0].entries,
            vec![merge(0, 0, 10.0), merge(1, 1, 0.0), merge(2, 2, 10.0)]
        );

        assert_eq!(
            partition_alignment(&alignment.alignments[0]),
            vec![
                AlignmentPartition::Anchor {
                    base_index: 0,
                    target_index: 0,
                },
                AlignmentPartition::Anchor {
                    base_index: 2,
                    target_index: 2,
                },
            ]
        );
    }

    // Returns every cell of a rows by cols rectangle.
    fn rectangle(rows: usize, cols: usize) -> Vec<(usize, usize)> {
        (0..rows)
            .flat_map(|r| (0..cols).map(move |c| (r, c)))
            .collect()
    }

    #[test]
    fn monotone_counts_the_binomial_choices_of_a_fully_compatible_region() {
        assert_eq!(count_monotone_matchings(&rectangle(5, 5), 5), 1);
        assert_eq!(count_monotone_matchings(&rectangle(5, 4), 4), 5); // C(5,4)
        assert_eq!(count_monotone_matchings(&rectangle(5, 7), 5), 21); // C(7,5)
    }

    #[test]
    fn monotone_counts_each_cell_once_for_a_single_match() {
        // size 1: every compatible cell is its own placement.
        assert_eq!(count_monotone_matchings(&rectangle(1, 4), 1), 4);
        assert_eq!(count_monotone_matchings(&rectangle(3, 3), 1), 9);
    }

    #[test]
    fn monotone_counts_nothing_when_size_exceeds_the_available_rows_or_columns() {
        assert_eq!(count_monotone_matchings(&rectangle(3, 5), 4), 0);
        assert_eq!(count_monotone_matchings(&rectangle(5, 3), 4), 0);
    }

    #[test]
    fn monotone_ignores_holes_in_a_region() {
        // 3x3 minus the (1,1) center; no way to fit a size of 3.
        let cells: Vec<_> = rectangle(3, 3)
            .into_iter()
            .filter(|&cell| cell != (1, 1))
            .collect();
        assert_eq!(count_monotone_matchings(&cells, 3), 0);
    }

    #[test]
    fn monotone_counts_diagonals_around_a_hole_in_a_wider_region() {
        // 3x4 minus (1,1): the full count is C(4,3) = 4, but two of them pass
        // through (1,1).
        let cells: Vec<_> = rectangle(3, 4)
            .into_iter()
            .filter(|&cell| cell != (1, 1))
            .collect();
        assert_eq!(count_monotone_matchings(&cells, 3), 2);
    }

    #[test]
    fn monotone_returns_1_for_a_matching_size_of_0() {
        assert_eq!(count_monotone_matchings(&rectangle(3, 3), 0), 1);
    }

    fn single_segment<'a>(partitions: &'a [AlignmentPartition<'a>]) -> &'a Segment<'a> {
        let segments: Vec<_> = partitions
            .iter()
            .filter_map(|partition| match partition {
                AlignmentPartition::Segment(segment) => Some(segment),
                AlignmentPartition::Anchor { .. } => None,
            })
            .collect();
        assert_eq!(segments.len(), 1);
        segments[0]
    }

    #[test]
    fn discriminability_scores_1_for_a_square_fully_compatible_segment() {
        let alignment = align(
            vec![vec![3.0; 3]; 3],
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);
        let la = &alignment.alignments[0];
        let partitions = partition_alignment(la);
        let segment = single_segment(&partitions);
        assert_eq!(
            segment.region,
            AlignmentRange {
                base_start: 0,
                base_end: 3,
                target_start: 0,
                target_end: 3,
            }
        );

        assert!((segment_discriminability(la, segment) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn discriminability_is_the_reciprocal_of_the_binomial_choices_of_a_wider_region() {
        let mut cells = vec![(0, 0, 10.0), (6, 8, 20.0)];
        for b in 1..=5 {
            for t in 1..=7 {
                cells.push((b, t, 3.0));
            }
        }
        let alignment = align(
            similarity(7, 9, &cells),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);
        let la = &alignment.alignments[0];
        let partitions = partition_alignment(la);
        let segment = single_segment(&partitions);
        assert_eq!(
            segment.region,
            AlignmentRange {
                base_start: 1,
                base_end: 6,
                target_start: 1,
                target_end: 8,
            }
        );

        assert!((segment_discriminability(la, segment) - 1.0 / 21.0).abs() < 1e-9);
    }

    #[test]
    fn discriminability_excludes_null_ticks_and_null_merges_from_the_region() {
        // A 2x3 ambiguous block of 3 monotone paths, ignoring the null row
        // which would make it 9.
        let alignment = align(
            similarity(
                3,
                3,
                &[
                    (0, 0, 3.0),
                    (0, 1, 3.0),
                    (0, 2, 3.0),
                    (2, 0, 3.0),
                    (2, 1, 3.0),
                    (2, 2, 3.0),
                ],
            ),
            &[1],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);
        let la = &alignment.alignments[0];
        let partitions = partition_alignment(la);
        let segment = single_segment(&partitions);
        assert_eq!(
            segment.entries,
            &[merge(0, 0, 3.0), merge(1, 1, 0.0), merge(2, 2, 3.0)]
        );
        assert_eq!(
            segment.region,
            AlignmentRange {
                base_start: 0,
                base_end: 3,
                target_start: 0,
                target_end: 3,
            }
        );

        assert!((segment_discriminability(la, segment) - 1.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn discriminability_falls_back_to_a_closed_form_on_a_region_too_large_to_enumerate() {
        // A 64x64 fully compatible block with a 64-merge diagonal. Rather than
        // using the O(64^5) exact path count DP, the closed form is used.
        let alignment = align(
            vec![vec![3.0; 64]; 64],
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);
        let la = &alignment.alignments[0];
        let partitions = partition_alignment(la);
        let segment = single_segment(&partitions);
        assert_eq!(
            segment.region,
            AlignmentRange {
                base_start: 0,
                base_end: 64,
                target_start: 0,
                target_end: 64,
            }
        );

        assert!((segment_discriminability(la, segment) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn discriminability_bounds_an_edge_segment_by_its_merges_ignoring_a_far_compatible_void() {
        // Three plateau-2 merges at ticks 10-12 inside a much larger search
        // range. A compatible diagonal at 0-5 sits in the unaligned void below
        // them. Only the merge region should be considered.
        let mut cells = vec![
            (10, 10, 10.0),
            (10, 11, 10.0),
            (11, 11, 10.0),
            (11, 12, 10.0),
            (12, 12, 10.0),
            (12, 13, 10.0),
        ];
        cells.extend((0..6).map(|i| (i, i, 1.0)));
        let alignment = align(
            similarity(20, 20, &cells),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 2);
        let la = &alignment.alignments[1];
        assert_eq!(
            la.range,
            AlignmentRange {
                base_start: 0,
                base_end: 20,
                target_start: 0,
                target_end: 20,
            }
        );
        let partitions = partition_alignment(la);
        let segment = single_segment(&partitions);
        assert_eq!(
            segment.region,
            AlignmentRange {
                base_start: 10,
                base_end: 13,
                target_start: 10,
                target_end: 14,
            }
        );

        assert!((segment_discriminability(la, segment) - 1.0 / 4.0).abs() < 1e-9);
    }

    #[test]
    fn bonus_support_approaches_1_when_every_step_is_decisive() {
        let alignment = align(
            similarity(3, 3, &[(0, 0, 50.0), (1, 1, 50.0), (2, 2, 50.0)]),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);
        let la = &alignment.alignments[0];
        let segment = Segment {
            entries: &la.entries,
            region: la.range,
        };

        assert!(segment_bonus_support(la, &segment, 5.0, 0.1, 0.0) > 0.99);
    }

    #[test]
    fn bonus_support_increases_with_the_per_step_margin() {
        let config = || AlignmentConfig {
            min_score: 1.0,
            min_length: 1,
            min_context: 1,
            gap_penalty: 5.0,
        };
        let weak = align(
            similarity(3, 3, &[(0, 0, 2.0), (1, 1, 2.0), (2, 2, 2.0)]),
            &[],
            &[],
            config(),
        );
        let strong = align(
            similarity(3, 3, &[(0, 0, 20.0), (1, 1, 20.0), (2, 2, 20.0)]),
            &[],
            &[],
            config(),
        );
        assert_eq!(weak.alignments.len(), 1);
        assert_eq!(strong.alignments.len(), 1);
        let weak = &weak.alignments[0];
        let strong = &strong.alignments[0];
        assert_eq!(weak.entries.len(), 3);
        assert_eq!(strong.entries.len(), 3);

        let support = |la: &LocalAlignment| {
            segment_bonus_support(
                la,
                &Segment {
                    entries: &la.entries,
                    region: la.range,
                },
                5.0,
                0.1,
                0.0,
            )
        };
        assert!(support(strong) > support(weak));
    }

    #[test]
    fn bonus_support_collapses_toward_the_weakest_step() {
        // Per-step supports are [~1, 0, ~1] so the arithmetic mean is 0.67,
        // but the score should be dragged down beyond that by the weak step.
        let alignment = align(
            similarity(
                3,
                3,
                &[(0, 0, 50.0), (0, 1, 60.0), (1, 1, 5.0), (2, 2, 50.0)],
            ),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);
        let la = &alignment.alignments[0];
        assert_eq!(
            la.entries,
            vec![merge(0, 0, 50.0), merge(1, 1, 5.0), merge(2, 2, 50.0)]
        );
        let segment = Segment {
            entries: &la.entries,
            region: la.range,
        };

        let support = segment_bonus_support(la, &segment, 5.0, 0.1, 0.0);
        assert!(support < 0.2);
        assert!(support > 0.0);
    }

    #[test]
    fn bonus_support_reads_the_margin_at_the_cell_each_gap_step_occupies() {
        let alignment = align(
            similarity(3, 2, &[(0, 0, 5.0), (2, 1, 50.0)]),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);
        let la = &alignment.alignments[0];
        assert_eq!(
            la.entries,
            vec![merge(0, 0, 5.0), keep(1), merge(2, 1, 50.0)]
        );
        let segment = Segment {
            entries: &la.entries,
            region: la.range,
        };

        assert!(segment_bonus_support(la, &segment, 5.0, 0.1, 0.0) < 0.2);
    }

    #[test]
    fn bonus_support_skips_a_null_merge() {
        // The middle merge is a null (base tick 1); its margin would reduce
        // the support if counted. Skipping it leaves two decisive merges.
        let alignment = align(
            similarity(3, 3, &[(0, 0, 50.0), (2, 2, 50.0)]),
            &[1],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);
        let la = &alignment.alignments[0];
        assert_eq!(
            la.entries,
            vec![merge(0, 0, 50.0), merge(1, 1, 0.0), merge(2, 2, 50.0)]
        );
        let segment = Segment {
            entries: &la.entries,
            region: la.range,
        };

        assert!(segment_bonus_support(la, &segment, 5.0, 0.1, 0.0) > 0.99);
    }

    #[test]
    fn bonus_support_subtracts_the_baseline_weight_from_merge_cell_margins() {
        let alignment = align(
            similarity(3, 3, &[(0, 0, 9.0), (1, 1, 9.0), (2, 2, 9.0)]),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);
        let la = &alignment.alignments[0];
        assert_eq!(la.entries.len(), 3);
        let segment = Segment {
            entries: &la.entries,
            region: la.range,
        };

        assert!(
            segment_bonus_support(la, &segment, 5.0, 0.1, 4.0)
                < segment_bonus_support(la, &segment, 5.0, 0.1, 0.0)
        );
    }

    #[test]
    fn bonus_support_does_not_subtract_the_baseline_from_gap_cell_margins() {
        // The KEEP gap occupies the weakest cell; the merges are strong.
        let alignment = align(
            similarity(
                4,
                3,
                &[(0, 0, 50.0), (1, 1, 50.0), (2, 0, 95.0), (3, 2, 50.0)],
            ),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);
        let la = &alignment.alignments[0];
        assert_eq!(
            la.entries,
            vec![
                merge(0, 0, 50.0),
                merge(1, 1, 50.0),
                keep(2),
                merge(3, 2, 50.0)
            ]
        );
        let segment = Segment {
            entries: &la.entries,
            region: la.range,
        };

        let with_baseline = segment_bonus_support(la, &segment, 5.0, 0.1, 4.0);
        let without_baseline = segment_bonus_support(la, &segment, 5.0, 0.1, 0.0);
        assert!(without_baseline < 0.9);
        assert!((with_baseline - without_baseline).abs() < 1e-3);
    }

    #[test]
    fn step_confidence_returns_max_for_an_identity_step() {
        let confidence = score_step_confidence(
            None,
            &ReconciliationCounters {
                player_attack_pairs: 0,
                player_spell_pairs: 0,
                npc_attack_pairs: 0,
                stream_event_pairs: 0,
                attack_mapped_events: 0,
            },
            &[],
            &ConfidenceWeights {
                axis: 0.5,
                support_scale: 5.0,
                support_temperature: 0.1,
                disagreement: 0.6,
                large_gap: 0.2,
                attack_mapped_failure: 0.2,
            },
            4.0,
        );

        assert_eq!(
            confidence,
            StepConfidence {
                overall: 1.0,
                structural: StructuralConfidence {
                    value: 1.0,
                    identity: true,
                    target_coverage: 1.0,
                    segments: Vec::new(),
                    worst_segment_idx: None,
                },
                content: ContentConfidence {
                    value: 1.0,
                    disagreement_rate: 0.0,
                    large_gap_rate: 0.0,
                    attack_mapped_failure_rate: 0.0,
                },
            }
        );
    }

    #[test]
    fn step_confidence_maximally_scores_a_clean_conflict_free_alignment() {
        let config = || AlignmentConfig {
            min_score: 1.0,
            min_length: 1,
            min_context: 1,
            gap_penalty: 5.0,
        };
        let anchored = |length: usize| {
            let cells: Vec<_> = (0..length).map(|i| (i, i, 10.0)).collect();
            align(similarity(length, length, &cells), &[], &[], config())
        };
        let counters = ReconciliationCounters {
            player_attack_pairs: 0,
            player_spell_pairs: 0,
            npc_attack_pairs: 0,
            stream_event_pairs: 0,
            attack_mapped_events: 0,
        };
        let weights = ConfidenceWeights {
            axis: 0.5,
            support_scale: 5.0,
            support_temperature: 0.1,
            disagreement: 0.6,
            large_gap: 0.2,
            attack_mapped_failure: 0.2,
        };

        let full = StepConfidence {
            overall: 1.0,
            structural: StructuralConfidence {
                value: 1.0,
                identity: false,
                target_coverage: 1.0,
                segments: Vec::new(),
                worst_segment_idx: None,
            },
            content: ContentConfidence {
                value: 1.0,
                disagreement_rate: 0.0,
                large_gap_rate: 0.0,
                attack_mapped_failure_rate: 0.0,
            },
        };
        assert_eq!(
            score_step_confidence(Some(&anchored(4)), &counters, &[], &weights, 4.0),
            full
        );
        assert_eq!(
            score_step_confidence(Some(&anchored(40)), &counters, &[], &weights, 4.0),
            full
        );
    }

    #[test]
    fn step_confidence_scales_structural_confidence_with_target_coverage() {
        let config = || AlignmentConfig {
            min_score: 1.0,
            min_length: 1,
            min_context: 1,
            gap_penalty: 5.0,
        };
        let cells: Vec<_> = (0..40).map(|i| (i, i, 10.0)).collect();
        let full = align(similarity(40, 40, &cells), &[], &[], config());
        let half = align(similarity(40, 80, &cells), &[], &[], config());
        let counters = ReconciliationCounters {
            player_attack_pairs: 0,
            player_spell_pairs: 0,
            npc_attack_pairs: 0,
            stream_event_pairs: 0,
            attack_mapped_events: 0,
        };
        let weights = ConfidenceWeights {
            axis: 0.5,
            support_scale: 5.0,
            support_temperature: 0.1,
            disagreement: 0.6,
            large_gap: 0.2,
            attack_mapped_failure: 0.2,
        };

        let full = score_step_confidence(Some(&full), &counters, &[], &weights, 4.0);
        let half = score_step_confidence(Some(&half), &counters, &[], &weights, 4.0);
        assert!((half.structural.target_coverage - 0.5).abs() < 1e-9);
        assert!((half.structural.value - full.structural.value * 0.5).abs() < 1e-9);
    }

    #[test]
    fn step_confidence_penalizes_content_conflicts() {
        // 1 mismatch in 4 reconciliation attempts on an otherwise clean step.
        let confidence = score_step_confidence(
            None,
            &ReconciliationCounters {
                player_attack_pairs: 4,
                player_spell_pairs: 0,
                npc_attack_pairs: 0,
                stream_event_pairs: 0,
                attack_mapped_events: 0,
            },
            &[QualityFlag::Disagreement {
                tick: Tick(3),
                kept_source: ClientId(1),
                discarded_source: ClientId(2),
                subject: Disagreement::PlayerAttackKind {
                    player: "1Ogp".to_string(),
                    kept: PlayerAttack::Scythe,
                    discarded: PlayerAttack::BgsSpec,
                },
            }],
            &ConfidenceWeights {
                axis: 0.5,
                support_scale: 5.0,
                support_temperature: 0.1,
                disagreement: 0.6,
                large_gap: 0.2,
                attack_mapped_failure: 0.2,
            },
            4.0,
        );

        assert!((confidence.content.disagreement_rate - 0.25).abs() < 1e-9);
        assert!(confidence.content.value < 1.0);
        // The overall is a blend of perfect structure (identity) and the
        // penalized content, so it lands between them.
        assert!(confidence.overall < confidence.structural.value);
        assert!(confidence.overall > confidence.content.value);
    }

    #[test]
    fn step_confidence_reports_the_lowest_score_across_multiple_segments() {
        // Two segments with discriminability 1/3 and 1/6, and no bonus support.
        let mut cells = vec![(0, 0, 10.0), (3, 4, 10.0), (6, 9, 20.0)];
        for b in 1..=2 {
            for t in 1..=3 {
                cells.push((b, t, 3.0));
            }
        }
        for b in 4..=5 {
            for t in 5..=8 {
                cells.push((b, t, 3.0));
            }
        }
        let alignment = align(
            similarity(7, 10, &cells),
            &[],
            &[],
            AlignmentConfig {
                min_score: 1.0,
                min_length: 1,
                min_context: 1,
                gap_penalty: 5.0,
            },
        );
        assert_eq!(alignment.alignments.len(), 1);

        let StructuralConfidence {
            segments,
            worst_segment_idx,
            ..
        } = score_step_confidence(
            Some(&alignment),
            &ReconciliationCounters {
                player_attack_pairs: 0,
                player_spell_pairs: 0,
                npc_attack_pairs: 0,
                stream_event_pairs: 0,
                attack_mapped_events: 0,
            },
            &[],
            &ConfidenceWeights {
                axis: 0.5,
                support_scale: 5.0,
                support_temperature: 0.1,
                disagreement: 0.6,
                large_gap: 0.2,
                attack_mapped_failure: 0.2,
            },
            4.0,
        )
        .structural;

        assert_eq!(segments.len(), 2);
        assert_eq!((segments[0].base_start, segments[0].base_end), (1, 3));
        assert_eq!((segments[1].base_start, segments[1].base_end), (4, 6));
        assert!((segments[0].score - 1.0 / 3.0).abs() < 1e-9);
        assert!((segments[1].score - 1.0 / 6.0).abs() < 1e-9);
        assert_eq!(worst_segment_idx, Some(1));
    }

    #[test]
    fn step_confidence_weighs_the_structural_axis_as_configured() {
        // Perfect structure, but one mismatch.
        let counters = ReconciliationCounters {
            player_attack_pairs: 2,
            player_spell_pairs: 0,
            npc_attack_pairs: 0,
            stream_event_pairs: 0,
            attack_mapped_events: 0,
        };
        let flags = [QualityFlag::Disagreement {
            tick: Tick(1),
            kept_source: ClientId(1),
            discarded_source: ClientId(2),
            subject: Disagreement::PlayerAttackKind {
                player: "1Ogp".to_string(),
                kept: PlayerAttack::Scythe,
                discarded: PlayerAttack::BgsSpec,
            },
        }];
        let weights = |axis: f64| ConfidenceWeights {
            axis,
            support_scale: 5.0,
            support_temperature: 0.1,
            disagreement: 0.6,
            large_gap: 0.2,
            attack_mapped_failure: 0.2,
        };

        let structural_heavy = score_step_confidence(None, &counters, &flags, &weights(0.9), 4.0);
        let content_heavy = score_step_confidence(None, &counters, &flags, &weights(0.1), 4.0);
        assert!(structural_heavy.overall > content_heavy.overall);
    }
}
