//! Aligner for timelines.
#![expect(dead_code)]

use std::collections::BTreeSet;

use super::timeline::TickState;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum AlignmentEntry {
    /// Base and target ticks are aligned.
    Merge {
        base_index: usize,
        target_index: usize,
        score: f64,
    },
    /// Target-only tick (gap in base).
    Insert { target_index: usize },
    /// Base-only tick (gap in target).
    Keep { base_index: usize },
}

/// `[start, end)` range of base and target tick indices for a local alignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct AlignmentRange {
    pub base_start: usize,
    pub base_end: usize,
    pub target_start: usize,
    pub target_end: usize,
}

#[derive(Debug)]
pub(super) struct Matrix<T> {
    cols: usize,
    cells: Vec<T>,
}

impl<T: Copy + Default> Matrix<T> {
    fn new(rows: usize, cols: usize) -> Self {
        Self {
            cols,
            cells: vec![T::default(); rows * cols],
        }
    }

    pub fn get(&self, row: usize, col: usize) -> T {
        self.cells[row * self.cols + col]
    }

    fn set(&mut self, row: usize, col: usize, value: T) {
        self.cells[row * self.cols + col] = value;
    }
}

pub(super) struct LocalAlignment {
    /// Sequence of actions for this alignment.
    pub entries: Vec<AlignmentEntry>,
    /// The range over which the aligner ran to produce this alignment.
    pub range: AlignmentRange,
    /// Per-cell similarity scores.
    /// A value of negative infinity indicates incompatibility.
    similarity: Matrix<f64>,
    /// The difference between the chosen action and its best alternative for
    /// each cell. Indexed the same as `similarity`.
    margin: Matrix<f64>,
    /// Absolute indices of null base ticks within the range. A null tick
    /// scores 0 in [`similarity`], so these sets let consumers tell "no data"
    /// apart from a genuine zero score.
    pub base_null: BTreeSet<usize>,
    /// Absolute indices of null target ticks within the range.
    pub target_null: BTreeSet<usize>,
}

impl LocalAlignment {
    /// The similarity score of the absolute tick indices `base` and `target`.
    /// Indices must lie within `range`.
    pub fn similarity(&self, base: usize, target: usize) -> f64 {
        self.similarity.get(
            base - self.range.base_start,
            target - self.range.target_start,
        )
    }

    /// The difference between the chosen action between ticks at indices `base`
    /// and `target` and its best alternative.
    /// Indices must lie within `range`.
    pub fn margin(&self, base: usize, target: usize) -> f64 {
        self.margin.get(
            base - self.range.base_start,
            target - self.range.target_start,
        )
    }
}

pub(super) struct AlignmentResult {
    /// Ordered local alignments extracted from the scoring matrix.
    pub alignments: Vec<LocalAlignment>,
    /// Fraction of base ticks merged or kept in a local alignment.
    pub base_coverage: f64,
    /// Fraction of target ticks merged or inserted into a local alignment.
    pub target_coverage: f64,
    /// Total number of gap actions (insert and keep) across all alignments.
    pub gap_count: usize,
}

/// Tunable parameters for timeline alignment.
#[derive(Debug, Clone)]
pub(super) struct AlignmentConfig {
    /// The minimum score required for an alignment to be considered valid.
    pub min_score: f64,
    /// The minimum length required for an alignment to be considered valid.
    pub min_length: usize,
    /// The minimum number of ticks required in each timeline before attempting
    /// to align them.
    ///
    /// This should be set to a value larger than `min_length` to provide
    /// extra context from surrounding ticks and allow for identifying gaps.
    pub min_context: usize,
    /// The penalty for a gap.
    pub gap_penalty: f64,
}

impl Default for AlignmentConfig {
    fn default() -> Self {
        Self {
            min_score: 5.0,
            min_length: 3,
            min_context: 10,
            gap_penalty: 5.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum Direction {
    #[default]
    None, // Restart alignment
    Match,
    GapTarget,
    GapBase,
}

struct AlignmentMatrices {
    matrix: Matrix<f64>,
    direction: Matrix<Direction>,
    similarity: Matrix<f64>,
    margin: Matrix<f64>,
}

pub(super) struct TickAligner<'a, F> {
    config: AlignmentConfig,
    base: &'a [Option<TickState>],
    target: &'a [Option<TickState>],
    score_fn: F,
    alignments: Vec<LocalAlignment>,
}

impl<'a, F: Fn(&TickState, &TickState) -> f64> TickAligner<'a, F> {
    pub fn new(
        base: &'a [Option<TickState>],
        target: &'a [Option<TickState>],
        score_fn: F,
    ) -> Self {
        Self::with_config(base, target, score_fn, AlignmentConfig::default())
    }

    pub fn with_config(
        base: &'a [Option<TickState>],
        target: &'a [Option<TickState>],
        score_fn: F,
        config: AlignmentConfig,
    ) -> Self {
        assert!(config.gap_penalty > 0.0, "gap_penalty must be positive");
        Self {
            config,
            base,
            target,
            score_fn,
            alignments: Vec::new(),
        }
    }

    #[expect(clippy::cast_precision_loss)]
    pub fn align(mut self) -> AlignmentResult {
        self.align_over(AlignmentRange {
            base_start: 0,
            base_end: self.base.len(),
            target_start: 0,
            target_end: self.target.len(),
        });

        let mut merge_count = 0usize;
        let mut keep_count = 0usize;
        let mut insert_count = 0usize;
        for alignment in &self.alignments {
            for entry in &alignment.entries {
                match entry {
                    AlignmentEntry::Merge { .. } => merge_count += 1,
                    AlignmentEntry::Keep { .. } => keep_count += 1,
                    AlignmentEntry::Insert { .. } => insert_count += 1,
                }
            }
        }

        let base_placed = merge_count + keep_count;
        let target_placed = merge_count + insert_count;

        AlignmentResult {
            alignments: self.alignments,
            base_coverage: if self.base.is_empty() {
                0.0
            } else {
                base_placed as f64 / self.base.len() as f64
            },
            target_coverage: if self.target.is_empty() {
                0.0
            } else {
                target_placed as f64 / self.target.len() as f64
            },
            gap_count: keep_count + insert_count,
        }
    }

    fn align_over(&mut self, range: AlignmentRange) {
        if range.base_end - range.base_start < self.config.min_context
            || range.target_end - range.target_start < self.config.min_context
        {
            return;
        }

        let Some(local) = self.align_local(range) else {
            return;
        };

        let AlignmentEntry::Merge {
            base_index: first_base,
            target_index: first_target,
            ..
        } = local.entries[0]
        else {
            unreachable!("local alignment starts with a merge entry");
        };
        let AlignmentEntry::Merge {
            base_index: last_base,
            target_index: last_target,
            ..
        } = local.entries[local.entries.len() - 1]
        else {
            unreachable!("local alignment ends with a merge entry");
        };

        self.align_over(AlignmentRange {
            base_start: range.base_start,
            base_end: first_base,
            target_start: range.target_start,
            target_end: first_target,
        });

        self.alignments.push(local);

        self.align_over(AlignmentRange {
            base_start: last_base + 1,
            base_end: range.base_end,
            target_start: last_target + 1,
            target_end: range.target_end,
        });
    }

    fn align_local(&self, range: AlignmentRange) -> Option<LocalAlignment> {
        let matrices = self.fill_matrices(range);
        let entries = self.backtrack_best(range, &matrices)?;
        if entries.len() < self.config.min_length {
            return None;
        }

        let base_null = (range.base_start..range.base_end)
            .filter(|&i| self.base[i].is_none())
            .collect();
        let target_null = (range.target_start..range.target_end)
            .filter(|&j| self.target[j].is_none())
            .collect();

        Some(LocalAlignment {
            entries,
            range,
            similarity: matrices.similarity,
            margin: matrices.margin,
            base_null,
            target_null,
        })
    }

    /// Finds the highest-scoring cell in the matrix and backtracks to extract
    /// its alignment.
    fn backtrack_best(
        &self,
        range: AlignmentRange,
        matrices: &AlignmentMatrices,
    ) -> Option<Vec<AlignmentEntry>> {
        let rows = range.base_end - range.base_start;
        let cols = range.target_end - range.target_start;

        // Find the global maximum.
        let mut max_score = 0.0;
        let mut max_i = 0;
        let mut max_j = 0;
        for i in 0..rows {
            for j in 0..cols {
                if matrices.matrix.get(i, j) > max_score {
                    max_score = matrices.matrix.get(i, j);
                    max_i = i;
                    max_j = j;
                }
            }
        }

        if max_score < self.config.min_score {
            return None;
        }

        // Trace back from the maximum, collecting all actions.
        let mut entries = Vec::new();
        let mut i = max_i;
        let mut j = max_j;

        loop {
            match matrices.direction.get(i, j) {
                Direction::None => break,
                Direction::Match => {
                    entries.push(AlignmentEntry::Merge {
                        base_index: range.base_start + i,
                        target_index: range.target_start + j,
                        score: matrices.similarity.get(i, j),
                    });
                    if i == 0 || j == 0 {
                        break;
                    }
                    i -= 1;
                    j -= 1;
                }
                Direction::GapTarget => {
                    entries.push(AlignmentEntry::Keep {
                        base_index: range.base_start + i,
                    });
                    if i == 0 {
                        break;
                    }
                    i -= 1;
                }
                Direction::GapBase => {
                    entries.push(AlignmentEntry::Insert {
                        target_index: range.target_start + j,
                    });
                    if j == 0 {
                        break;
                    }
                    j -= 1;
                }
            }
        }

        entries.reverse();
        Some(entries)
    }

    #[expect(clippy::float_cmp)]
    fn fill_matrices(&self, range: AlignmentRange) -> AlignmentMatrices {
        let rows = range.base_end - range.base_start;
        let cols = range.target_end - range.target_start;

        let mut matrix = Matrix::new(rows, cols);
        let mut direction = Matrix::new(rows, cols);
        let mut similarity = Matrix::new(rows, cols);
        let mut margin = Matrix::new(rows, cols);

        for i in 0..rows {
            for j in 0..cols {
                let similarity_score =
                    self.score_similarity(range.base_start + i, range.target_start + j);
                similarity.set(i, j, similarity_score);

                let gap_penalty = self.config.gap_penalty; // TODO(frolv): affine

                let diagonal = if i > 0 && j > 0 {
                    matrix.get(i - 1, j - 1)
                } else {
                    0.0
                };
                let above = if i > 0 { matrix.get(i - 1, j) } else { 0.0 };
                let left = if j > 0 { matrix.get(i, j - 1) } else { 0.0 };

                let scores = [
                    0.0,
                    diagonal + similarity_score,
                    above - gap_penalty,
                    left - gap_penalty,
                ];

                let max_score = scores.into_iter().fold(f64::NEG_INFINITY, f64::max);
                matrix.set(i, j, max_score);

                // Choose direction based on which path gave the max score.
                let winner = if max_score == scores[1] && similarity_score.is_finite() {
                    direction.set(i, j, Direction::Match);
                    1
                } else if max_score == scores[2] {
                    direction.set(i, j, Direction::GapTarget);
                    2
                } else if max_score == scores[3] {
                    direction.set(i, j, Direction::GapBase);
                    3
                } else {
                    direction.set(i, j, Direction::None);
                    0
                };

                // How much the chosen branch beat the next best alternative.
                if winner != 0 {
                    let mut second_best = f64::NEG_INFINITY;
                    for (k, &score) in scores.iter().enumerate() {
                        if k != winner && score > second_best {
                            second_best = score;
                        }
                    }
                    margin.set(i, j, max_score - second_best);
                }
            }
        }

        AlignmentMatrices {
            matrix,
            direction,
            similarity,
            margin,
        }
    }

    fn score_similarity(&self, i: usize, j: usize) -> f64 {
        match (&self.base[i], &self.target[j]) {
            (Some(base), Some(target)) => (self.score_fn)(base, target),
            _ => 0.0,
        }
    }
}

#[cfg(test)]
mod tests {
    #![expect(clippy::float_cmp, reason = "scores come from controlled mock scorers")]

    use std::collections::BTreeMap;

    use super::*;
    use crate::lifecycle::core::types::Stage;
    use crate::merging::{Tick, fixtures};

    const STAGE: Stage = Stage::TobMaiden;

    // Each listed tick gets a state with a dummy player so it's non-null, at
    // its position in the list, so tick numbers are decoupled from indices.
    fn make_timeline(ticks: &[u32]) -> Vec<Option<TickState>> {
        let party = vec!["1Ogp".to_string()];
        let events = ticks
            .iter()
            .map(|&t| fixtures::PlayerUpdateEvent::new(Tick(t), STAGE, "1Ogp", (10, 20)).build())
            .collect();
        let max_tick = ticks.iter().copied().max().unwrap_or(0);
        let timeline = fixtures::timeline(&party, Tick(max_tick), events);
        ticks
            .iter()
            .map(|&t| {
                Some(
                    timeline
                        .get(Tick(t))
                        .expect("tick has recorded state")
                        .clone(),
                )
            })
            .collect()
    }

    fn make_indexed_timeline(length: u32) -> Vec<Option<TickState>> {
        let ticks: Vec<u32> = (0..length).collect();
        make_timeline(&ticks)
    }

    fn tick_match_scorer(match_score: f64) -> impl Fn(&TickState, &TickState) -> f64 {
        move |a, b| {
            if a.tick() == b.tick() {
                match_score
            } else {
                f64::NEG_INFINITY
            }
        }
    }

    // `matrix[i][j]` scores base tick `i` against target tick `j`, so this
    // only works on timelines where tick numbers equal array indices.
    fn matrix_scorer(matrix: Vec<Vec<f64>>) -> impl Fn(&TickState, &TickState) -> f64 {
        move |a, b| {
            matrix
                .get(a.tick().0 as usize)
                .and_then(|row| row.get(b.tick().0 as usize))
                .copied()
                .unwrap_or(0.0)
        }
    }

    // Returns sorted (target_index, base_index) pairs of `Merge` entries.
    fn extract_mapping(result: &AlignmentResult) -> Vec<(usize, usize)> {
        let mut pairs: Vec<(usize, usize)> = result
            .alignments
            .iter()
            .flat_map(|alignment| &alignment.entries)
            .filter_map(|entry| match entry {
                AlignmentEntry::Merge {
                    base_index,
                    target_index,
                    ..
                } => Some((*target_index, *base_index)),
                _ => None,
            })
            .collect();
        pairs.sort_unstable();
        pairs
    }

    // Returns `Merge` entry scores by target index.
    fn extract_scores(result: &AlignmentResult) -> BTreeMap<usize, f64> {
        result
            .alignments
            .iter()
            .flat_map(|alignment| &alignment.entries)
            .filter_map(|entry| match entry {
                AlignmentEntry::Merge {
                    target_index,
                    score,
                    ..
                } => Some((*target_index, *score)),
                _ => None,
            })
            .collect()
    }

    fn merge_count(result: &AlignmentResult) -> usize {
        extract_mapping(result).len()
    }

    #[test]
    fn identical_timelines_produce_a_one_to_one_mapping_with_full_coverage() {
        let base = make_timeline(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        let target = make_timeline(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

        let result = TickAligner::with_config(
            &base,
            &target,
            tick_match_scorer(3.0),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 5.0,
            },
        )
        .align();

        assert_eq!(
            extract_mapping(&result),
            vec![
                (0, 0),
                (1, 1),
                (2, 2),
                (3, 3),
                (4, 4),
                (5, 5),
                (6, 6),
                (7, 7),
                (8, 8),
                (9, 9),
            ],
        );
        assert_eq!(result.base_coverage, 1.0);
        assert_eq!(result.target_coverage, 1.0);
        assert_eq!(result.gap_count, 0);
    }

    #[test]
    fn identical_timelines_return_a_single_local_alignment_with_only_merge_entries() {
        const SCORE: f64 = 3.0;

        let base = make_timeline(&[1, 2, 3, 4, 5]);
        let target = make_timeline(&[1, 2, 3, 4, 5]);

        let result = TickAligner::with_config(
            &base,
            &target,
            tick_match_scorer(SCORE),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 10.0, // keep alternatives 0
            },
        )
        .align();

        assert_eq!(result.alignments.len(), 1);
        let alignment = &result.alignments[0];
        for entry in &alignment.entries {
            assert!(matches!(entry, AlignmentEntry::Merge { .. }));
        }
        let mut expected_margin = SCORE;
        for i in 0..base.len() {
            assert_eq!(alignment.similarity(i, i), SCORE);
            assert_eq!(alignment.margin(i, i), expected_margin);
            expected_margin += SCORE;
        }
    }

    #[test]
    fn aligns_an_offset_target_to_the_correct_region_of_the_base() {
        let base = make_timeline(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        let target = make_timeline(&[5, 6, 7, 8, 9, 10]);

        let result = TickAligner::with_config(
            &base,
            &target,
            tick_match_scorer(3.0),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 5.0,
            },
        )
        .align();

        // Target indices 0-5 map onto base indices 4-9.
        assert_eq!(
            extract_mapping(&result),
            vec![(0, 4), (1, 5), (2, 6), (3, 7), (4, 8), (5, 9)],
        );
        assert_eq!(result.base_coverage, 0.6);
        assert_eq!(result.target_coverage, 1.0);
        assert_eq!(result.gap_count, 0);
    }

    #[test]
    fn aligns_a_target_that_ends_early() {
        let base = make_timeline(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        let target = make_timeline(&[1, 2, 3, 4, 5]);

        let result = TickAligner::with_config(
            &base,
            &target,
            tick_match_scorer(3.0),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 5.0,
            },
        )
        .align();

        assert_eq!(
            extract_mapping(&result),
            vec![(0, 0), (1, 1), (2, 2), (3, 3), (4, 4)],
        );
        assert_eq!(result.base_coverage, 0.5);
        assert_eq!(result.target_coverage, 1.0);
        assert_eq!(result.gap_count, 0);
    }

    #[test]
    fn emits_keep_entries_for_base_ticks_the_target_missed() {
        let base = make_timeline(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        let target = make_timeline(&[1, 2, 3, 4, 7, 8, 9, 10]);

        let result = TickAligner::with_config(
            &base,
            &target,
            tick_match_scorer(3.0),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 5.0,
            },
        )
        .align();

        assert_eq!(
            extract_mapping(&result),
            vec![
                (0, 0),
                (1, 1),
                (2, 2),
                (3, 3),
                (4, 6),
                (5, 7),
                (6, 8),
                (7, 9),
            ],
        );
        // All 10 base ticks are placed (8 merge, 2 keep), as are all 8 target.
        assert_eq!(result.base_coverage, 1.0);
        assert_eq!(result.target_coverage, 1.0);
        assert_eq!(result.gap_count, 2);

        let keep_indices: Vec<usize> = result
            .alignments
            .iter()
            .flat_map(|alignment| &alignment.entries)
            .filter_map(|entry| match entry {
                AlignmentEntry::Keep { base_index } => Some(*base_index),
                _ => None,
            })
            .collect();
        assert_eq!(keep_indices, vec![4, 5]);
    }

    #[test]
    fn emits_insert_entries_when_the_target_has_ticks_the_base_missed() {
        let base = make_timeline(&[1, 2, 3, 4, 6, 7, 8, 9, 10]);
        let target = make_timeline(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

        let result = TickAligner::with_config(
            &base,
            &target,
            tick_match_scorer(3.0),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 5.0,
            },
        )
        .align();

        assert_eq!(
            extract_mapping(&result),
            vec![
                (0, 0),
                (1, 1),
                (2, 2),
                (3, 3),
                (5, 4),
                (6, 5),
                (7, 6),
                (8, 7),
                (9, 8),
            ],
        );

        let insert_indices: Vec<usize> = result
            .alignments
            .iter()
            .flat_map(|alignment| &alignment.entries)
            .filter_map(|entry| match entry {
                AlignmentEntry::Insert { target_index } => Some(*target_index),
                _ => None,
            })
            .collect();
        assert_eq!(insert_indices, vec![4]);

        let keep_count = result
            .alignments
            .iter()
            .flat_map(|alignment| &alignment.entries)
            .filter(|entry| matches!(entry, AlignmentEntry::Keep { .. }))
            .count();
        assert_eq!(keep_count, 0);

        assert_eq!(result.gap_count, 1);
    }

    #[test]
    fn emits_both_keep_and_insert_when_each_side_misses_a_different_tick() {
        let base = make_timeline(&[1, 2, 3, 4, 5, 7, 8, 9, 10]);
        let target = make_timeline(&[1, 2, 3, 4, 6, 7, 8, 9, 10]);

        let result = TickAligner::with_config(
            &base,
            &target,
            tick_match_scorer(3.0),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 5.0,
            },
        )
        .align();

        assert_eq!(
            extract_mapping(&result),
            vec![
                (0, 0),
                (1, 1),
                (2, 2),
                (3, 3),
                (5, 5),
                (6, 6),
                (7, 7),
                (8, 8),
            ],
        );

        let keep_indices: Vec<usize> = result
            .alignments
            .iter()
            .flat_map(|alignment| &alignment.entries)
            .filter_map(|entry| match entry {
                AlignmentEntry::Keep { base_index } => Some(*base_index),
                _ => None,
            })
            .collect();
        assert_eq!(keep_indices, vec![4]);

        let insert_indices: Vec<usize> = result
            .alignments
            .iter()
            .flat_map(|alignment| &alignment.entries)
            .filter_map(|entry| match entry {
                AlignmentEntry::Insert { target_index } => Some(*target_index),
                _ => None,
            })
            .collect();
        assert_eq!(insert_indices, vec![4]);

        assert_eq!(result.gap_count, 2);
    }

    #[test]
    fn returns_empty_alignments_when_timelines_are_disjoint() {
        let base = make_timeline(&[1, 2, 3, 4, 5]);
        let target = make_timeline(&[20, 21, 22, 23, 24]);

        let result = TickAligner::with_config(
            &base,
            &target,
            tick_match_scorer(3.0),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 5.0,
            },
        )
        .align();

        assert_eq!(merge_count(&result), 0);
        assert!(result.alignments.is_empty());
        assert_eq!(result.base_coverage, 0.0);
        assert_eq!(result.target_coverage, 0.0);
    }

    #[test]
    fn rejects_alignments_shorter_than_the_minimum_length() {
        let base = make_timeline(&[1, 2, 3, 4, 5]);
        let target = make_timeline(&[4, 5, 20, 21, 22]);

        let result = TickAligner::with_config(
            &base,
            &target,
            tick_match_scorer(3.0),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 5.0,
            },
        )
        .align();

        assert_eq!(merge_count(&result), 0);
    }

    #[test]
    fn accepts_alignments_exactly_at_the_minimum_length() {
        let base = make_timeline(&[1, 2, 3, 4, 5]);
        let target = make_timeline(&[3, 4, 5, 20, 21]);

        let result = TickAligner::with_config(
            &base,
            &target,
            tick_match_scorer(3.0),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 5.0,
            },
        )
        .align();

        assert_eq!(merge_count(&result), 3);
    }

    #[test]
    fn scores_null_ticks_as_zero_without_breaking_the_alignment() {
        let base = make_timeline(&[1, 2, 3, 4, 5, 6, 7]);
        let mut target = make_timeline(&[1, 2, 3, 4, 5, 6, 7]);
        target[2] = None;
        target[3] = None;

        let result = TickAligner::with_config(
            &base,
            &target,
            tick_match_scorer(3.0),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 5.0,
            },
        )
        .align();

        assert_eq!(
            extract_mapping(&result),
            vec![(0, 0), (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6)],
        );

        for (target_index, score) in extract_scores(&result) {
            if target[target_index].is_none() {
                assert_eq!(score, 0.0);
            }
        }
    }

    #[test]
    fn records_per_pair_similarity_scores() {
        const SCORE: f64 = 7.0;

        let base = make_timeline(&[1, 2, 3, 4, 5]);
        let target = make_timeline(&[1, 2, 3, 4, 5]);

        let result = TickAligner::with_config(
            &base,
            &target,
            tick_match_scorer(SCORE),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 5.0,
            },
        )
        .align();

        let scores = extract_scores(&result);
        for score in scores.values() {
            assert_eq!(*score, SCORE);
        }
        assert_eq!(scores.len(), merge_count(&result));
    }

    #[test]
    fn extracts_two_separate_alignments_when_a_large_gap_splits_them() {
        let base = make_timeline(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        let target = make_timeline(&[1, 2, 3, 4, 5, 0, 0, 0, 11, 12, 13, 14, 15]);

        let result = TickAligner::with_config(
            &base,
            &target,
            tick_match_scorer(3.0),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 5.0,
            },
        )
        .align();

        assert_eq!(result.alignments.len(), 2);

        for alignment in &result.alignments {
            for entry in &alignment.entries {
                assert!(matches!(entry, AlignmentEntry::Merge { .. }));
            }
        }

        // Together they cover base indices 0-4 and 10-14.
        assert_eq!(
            extract_mapping(&result),
            vec![
                (0, 0),
                (1, 1),
                (2, 2),
                (3, 3),
                (4, 4),
                (8, 10),
                (9, 11),
                (10, 12),
                (11, 13),
                (12, 14),
            ],
        );
        assert_eq!(result.base_coverage, 10.0 / 15.0);
        assert_eq!(result.target_coverage, 10.0 / 13.0);
        assert_eq!(result.gap_count, 0);
    }

    #[test]
    fn preserves_action_order_within_a_local_alignment() {
        let base = make_timeline(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        let target = make_timeline(&[1, 2, 3, 4, 7, 8, 9, 10]);

        let result = TickAligner::with_config(
            &base,
            &target,
            tick_match_scorer(3.0),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 5.0,
            },
        )
        .align();

        for alignment in &result.alignments {
            let mut last_base: Option<usize> = None;
            let mut last_target: Option<usize> = None;
            for entry in &alignment.entries {
                match entry {
                    AlignmentEntry::Merge {
                        base_index,
                        target_index,
                        ..
                    } => {
                        assert!(last_base.is_none_or(|last| *base_index > last));
                        assert!(last_target.is_none_or(|last| *target_index > last));
                        last_base = Some(*base_index);
                        last_target = Some(*target_index);
                    }
                    AlignmentEntry::Keep { base_index } => {
                        assert!(last_base.is_none_or(|last| *base_index > last));
                        last_base = Some(*base_index);
                    }
                    AlignmentEntry::Insert { target_index } => {
                        assert!(last_target.is_none_or(|last| *target_index > last));
                        last_target = Some(*target_index);
                    }
                }
            }
        }
    }

    // Three disjoint diagonal islands with strong positives around the local
    // alignment boundaries. If extraction reused indices across passes,
    // overlap would be plausible here.
    #[test]
    fn does_not_reuse_base_or_target_indices_across_local_alignments() {
        let mut matrix = vec![vec![f64::NEG_INFINITY; 11]; 11];
        for i in 0..3 {
            matrix[i][i] = 2.0;
            matrix[i + 4][i + 4] = 4.0;
            matrix[i + 8][i + 8] = 2.0;
        }
        matrix[3][4] = 5.0;
        matrix[4][3] = 5.0;
        matrix[6][7] = 5.0;
        matrix[7][6] = 5.0;

        let base = make_indexed_timeline(11);
        let target = make_indexed_timeline(11);

        let result = TickAligner::with_config(
            &base,
            &target,
            matrix_scorer(matrix),
            AlignmentConfig {
                min_score: 5.0,
                min_length: 3,
                min_context: 3,
                gap_penalty: 5.0,
            },
        )
        .align();

        assert!(result.alignments.len() >= 2);

        let merges_by_alignment: Vec<Vec<(usize, usize)>> = result
            .alignments
            .iter()
            .map(|alignment| {
                alignment
                    .entries
                    .iter()
                    .filter_map(|entry| match entry {
                        AlignmentEntry::Merge {
                            base_index,
                            target_index,
                            ..
                        } => Some((*base_index, *target_index)),
                        _ => None,
                    })
                    .collect()
            })
            .collect();

        for i in 0..merges_by_alignment.len() {
            for j in i + 1..merges_by_alignment.len() {
                for (base_i, target_i) in &merges_by_alignment[i] {
                    for (base_j, target_j) in &merges_by_alignment[j] {
                        assert_ne!(base_i, base_j);
                        assert_ne!(target_i, target_j);
                    }
                }
            }
        }
    }
}
