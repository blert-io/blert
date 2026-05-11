import {
  AlignmentAction,
  AlignmentResult,
  TickAligner,
  SimilarityFn,
} from '../alignment';
import { createPlayerState, createTickState } from './fixtures';
import { TickState, TickStateArray } from '../tick-state';

/**
 * Creates a TickStateArray from tick numbers. Each tick gets a single dummy
 * player so it's non-null.
 */
function makeTimeline(ticks: number[], clientId: number): TickStateArray {
  return ticks.map((t) =>
    createTickState(t, [createPlayerState({ username: 'player1', clientId })]),
  );
}

/**
 * Creates a TickStateArray with tick values matching their array indices.
 */
function makeIndexedTimeline(length: number, clientId: number): TickStateArray {
  return makeTimeline(
    Array.from({ length }, (_, i) => i),
    clientId,
  );
}

/**
 * A mock scorer that returns `matchScore` when both tick states have the same
 * tick number, and `-Infinity` otherwise.
 */
function tickMatchScorer(matchScore: number = 3): SimilarityFn {
  return (a: TickState, b: TickState) =>
    a.getTick() === b.getTick() ? matchScore : -Infinity;
}

/**
 * Creates a scorer backed by a fixed similarity matrix.
 *
 * `matrix[i][j]` is the score for base tick `i` against target tick `j`.
 * This relies on timelines where tick numbers equal array indices.
 */
function matrixScorer(matrix: number[][]): SimilarityFn {
  return (a: TickState, b: TickState) =>
    matrix[a.getTick()]?.[b.getTick()] ?? 0;
}

function runAligner(
  base: TickStateArray,
  target: TickStateArray,
  scorer: SimilarityFn,
): AlignmentResult {
  return new TickAligner(base, target, scorer, {
    minContext: 3,
  }).align();
}

/**
 * Extracts a sorted [targetIndex, baseIndex][] mapping from an alignment
 * result, considering only MERGE entries.
 */
function extractMapping(result: AlignmentResult): [number, number][] {
  const pairs: [number, number][] = [];
  for (const alignment of result.alignments) {
    for (const entry of alignment) {
      if (entry.action === AlignmentAction.MERGE) {
        pairs.push([entry.targetIndex, entry.baseIndex]);
      }
    }
  }
  return pairs.sort((a, b) => a[0] - b[0]);
}

/**
 * Extracts per-pair similarity scores from the alignment result, keyed by
 * target index, for easier assertion.
 */
function extractScores(result: AlignmentResult): Map<number, number> {
  const scores = new Map<number, number>();
  for (const alignment of result.alignments) {
    for (const entry of alignment) {
      if (entry.action === AlignmentAction.MERGE) {
        scores.set(entry.targetIndex, entry.score);
      }
    }
  }
  return scores;
}

/** Counts total MERGE entries across all local alignments. */
function mergeCount(result: AlignmentResult): number {
  return extractMapping(result).length;
}

const BASE_CLIENT_ID = 1;
const TARGET_CLIENT_ID = 2;

describe('TickAligner', () => {
  describe('identical timelines', () => {
    it('produces a 1:1 mapping with full coverage', () => {
      const base = makeTimeline(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        BASE_CLIENT_ID,
      );
      const target = makeTimeline(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        TARGET_CLIENT_ID,
      );

      const result = runAligner(base, target, tickMatchScorer());

      expect(extractMapping(result)).toEqual([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 5],
        [6, 6],
        [7, 7],
        [8, 8],
        [9, 9],
      ]);
      expect(result.coverage).toBe(1);
      expect(result.gapCount).toBe(0);
    });

    it('returns a single local alignment with only MERGE entries', () => {
      const base = makeTimeline([1, 2, 3, 4, 5], BASE_CLIENT_ID);
      const target = makeTimeline([1, 2, 3, 4, 5], TARGET_CLIENT_ID);

      const result = runAligner(base, target, tickMatchScorer());

      expect(result.alignments).toHaveLength(1);
      for (const entry of result.alignments[0]) {
        expect(entry.action).toBe(AlignmentAction.MERGE);
      }
    });
  });

  describe('offset target', () => {
    it('aligns target to the correct region of the base', () => {
      const base = makeTimeline(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        BASE_CLIENT_ID,
      );
      const target = makeTimeline([5, 6, 7, 8, 9, 10], TARGET_CLIENT_ID);

      const result = runAligner(base, target, tickMatchScorer());

      // Target indices 0-5 should map to base indices 4-9.
      expect(extractMapping(result)).toEqual([
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
        [4, 8],
        [5, 9],
      ]);
      expect(result.coverage).toBe(0.6);
      expect(result.gapCount).toBe(0);
    });

    it('aligns target that ends early', () => {
      const base = makeTimeline(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        BASE_CLIENT_ID,
      );
      const target = makeTimeline([1, 2, 3, 4, 5], TARGET_CLIENT_ID);

      const result = runAligner(base, target, tickMatchScorer());

      expect(extractMapping(result)).toEqual([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
      ]);
      expect(result.coverage).toBe(0.5);
      expect(result.gapCount).toBe(0);
    });
  });

  describe('target with gaps', () => {
    it('emits KEEP entries for base ticks the target missed', () => {
      // Base has ticks 1-10, target is missing ticks 5-6.
      const base = makeTimeline(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        BASE_CLIENT_ID,
      );
      const target = makeTimeline([1, 2, 3, 4, 7, 8, 9, 10], TARGET_CLIENT_ID);

      const result = runAligner(base, target, tickMatchScorer());

      expect(extractMapping(result)).toEqual([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 6],
        [5, 7],
        [6, 8],
        [7, 9],
      ]);
      expect(result.coverage).toBe(0.8);
      expect(result.gapCount).toBe(2);

      const keepEntries = result.alignments.flatMap((a) =>
        a.filter((e) => e.action === AlignmentAction.KEEP),
      );

      // There should be KEEP entries for the base ticks the target missed.
      expect(keepEntries).toHaveLength(2);
      for (let i = 0; i < keepEntries.length; i++) {
        expect(keepEntries[i].baseIndex).toEqual(i + 4);
      }
    });

    it('emits INSERT entries when the target has ticks the base missed', () => {
      // Base is missing tick 5; target has the full range.
      const base = makeTimeline([1, 2, 3, 4, 6, 7, 8, 9, 10], BASE_CLIENT_ID);
      const target = makeTimeline(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        TARGET_CLIENT_ID,
      );

      const result = runAligner(base, target, tickMatchScorer());

      expect(extractMapping(result)).toEqual([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [5, 4],
        [6, 5],
        [7, 6],
        [8, 7],
        [9, 8],
      ]);

      // There should be an INSERT entry for the tick that the base missed.
      const insertEntries = result.alignments.flatMap((a) =>
        a.filter((e) => e.action === AlignmentAction.INSERT),
      );
      expect(insertEntries).toHaveLength(1);
      expect(insertEntries[0].targetIndex).toBe(4);

      const keepEntries = result.alignments.flatMap((a) =>
        a.filter((e) => e.action === AlignmentAction.KEEP),
      );
      expect(keepEntries).toHaveLength(0);

      expect(result.gapCount).toBe(1);
    });

    it('emits both KEEP and INSERT when each side is missing a different tick', () => {
      // Base is missing tick 6; target is missing tick 5.
      const base = makeTimeline([1, 2, 3, 4, 5, 7, 8, 9, 10], BASE_CLIENT_ID);
      const target = makeTimeline(
        [1, 2, 3, 4, 6, 7, 8, 9, 10],
        TARGET_CLIENT_ID,
      );

      const result = runAligner(base, target, tickMatchScorer());

      expect(extractMapping(result)).toEqual([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [5, 5],
        [6, 6],
        [7, 7],
        [8, 8],
      ]);

      const keepEntries = result.alignments.flatMap((a) =>
        a.filter((e) => e.action === AlignmentAction.KEEP),
      );
      expect(keepEntries).toHaveLength(1);
      expect(keepEntries[0].baseIndex).toBe(4);

      const insertEntries = result.alignments.flatMap((a) =>
        a.filter((e) => e.action === AlignmentAction.INSERT),
      );
      expect(insertEntries).toHaveLength(1);
      expect(insertEntries[0].targetIndex).toBe(4);

      expect(result.gapCount).toBe(2);
    });
  });

  describe('no overlap', () => {
    it('returns empty alignments when timelines are disjoint', () => {
      const base = makeTimeline([1, 2, 3, 4, 5], BASE_CLIENT_ID);
      const target = makeTimeline([20, 21, 22, 23, 24], TARGET_CLIENT_ID);

      const result = runAligner(base, target, tickMatchScorer());

      expect(mergeCount(result)).toBe(0);
      expect(result.alignments).toHaveLength(0);
      expect(result.coverage).toBe(0);
    });
  });

  describe('short sequences', () => {
    it('rejects alignments shorter than MIN_ALIGNMENT_LENGTH', () => {
      const base = makeTimeline([1, 2, 3, 4, 5], BASE_CLIENT_ID);
      const target = makeTimeline([4, 5, 20, 21, 22], TARGET_CLIENT_ID);

      const result = runAligner(base, target, tickMatchScorer());

      expect(mergeCount(result)).toBe(0);
    });

    it('accepts alignments exactly at MIN_ALIGNMENT_LENGTH', () => {
      const base = makeTimeline([1, 2, 3, 4, 5], BASE_CLIENT_ID);
      const target = makeTimeline([3, 4, 5, 20, 21], TARGET_CLIENT_ID);

      const result = runAligner(base, target, tickMatchScorer());

      expect(mergeCount(result)).toBe(3);
    });
  });

  describe('null tick states', () => {
    it('scores null ticks as 0 without breaking the alignment', () => {
      const base = makeTimeline([1, 2, 3, 4, 5, 6, 7], BASE_CLIENT_ID);
      const target: TickStateArray = makeTimeline(
        [1, 2, 3, 4, 5, 6, 7],
        TARGET_CLIENT_ID,
      );
      target[2] = null;
      target[3] = null;

      const result = runAligner(base, target, tickMatchScorer());

      const mapping = extractMapping(result);
      expect(mapping).toEqual([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 5],
        [6, 6],
      ]);

      // Null ticks should have a score of 0.
      const scores = extractScores(result);
      for (const [targetIdx, score] of scores) {
        if (target[targetIdx] === null) {
          expect(score).toBe(0);
        }
      }
    });
  });

  describe('scoring', () => {
    it('records per-pair similarity scores', () => {
      const base = makeTimeline([1, 2, 3, 4, 5], BASE_CLIENT_ID);
      const target = makeTimeline([1, 2, 3, 4, 5], TARGET_CLIENT_ID);
      const score = 7;

      const result = runAligner(base, target, tickMatchScorer(score));

      // Every aligned pair should have the mock score recorded.
      const scores = extractScores(result);
      for (const [, pairScore] of scores) {
        expect(pairScore).toBe(score);
      }
      expect(scores.size).toBe(mergeCount(result));
    });
  });

  describe('multiple local alignments', () => {
    it('extracts two separate alignments when a large gap splits them', () => {
      const base = makeTimeline(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        BASE_CLIENT_ID,
      );
      const target = makeTimeline(
        [1, 2, 3, 4, 5, 0, 0, 0, 11, 12, 13, 14, 15],
        TARGET_CLIENT_ID,
      );

      const result = runAligner(base, target, tickMatchScorer());

      expect(result.alignments).toHaveLength(2);

      // Each local alignment should contain only MERGE entries.
      for (const alignment of result.alignments) {
        for (const entry of alignment) {
          expect(entry.action).toBe(AlignmentAction.MERGE);
        }
      }

      // Together they cover base indices 0-4 and 10-14.
      expect(extractMapping(result)).toEqual([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [8, 10],
        [9, 11],
        [10, 12],
        [11, 13],
        [12, 14],
      ]);
      expect(result.coverage).toBe(10 / 15);
      expect(result.gapCount).toBe(0);
    });
  });

  describe('action ordering', () => {
    it('preserves action order within a local alignment', () => {
      const base = makeTimeline(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        BASE_CLIENT_ID,
      );
      const target = makeTimeline([1, 2, 3, 4, 7, 8, 9, 10], TARGET_CLIENT_ID);

      const result = runAligner(base, target, tickMatchScorer());

      // Each local alignment should have entries in order of increasing
      // base/target index.
      for (const alignment of result.alignments) {
        let lastBase = -1;
        let lastTarget = -1;
        for (const entry of alignment) {
          if (entry.action === AlignmentAction.MERGE) {
            expect(entry.baseIndex).toBeGreaterThan(lastBase);
            expect(entry.targetIndex).toBeGreaterThan(lastTarget);
            lastBase = entry.baseIndex;
            lastTarget = entry.targetIndex;
          } else if (entry.action === AlignmentAction.KEEP) {
            expect(entry.baseIndex).toBeGreaterThan(lastBase);
            lastBase = entry.baseIndex;
          } else if (entry.action === AlignmentAction.INSERT) {
            expect(entry.targetIndex).toBeGreaterThan(lastTarget);
            lastTarget = entry.targetIndex;
          }
        }
      }
    });
  });

  describe('counterexamples', () => {
    // Three disjoint diagonal islands force recursive extraction to return
    // multiple local alignments with no bridge path between islands.
    const disjointMatrix = Array.from({ length: 13 }, () =>
      Array<number>(13).fill(-Infinity),
    );
    for (let i = 0; i < 3; i++) {
      disjointMatrix[i][i] = 2;
      disjointMatrix[i + 5][i + 5] = 3;
      disjointMatrix[i + 10][i + 10] = 2;
    }

    // Similar to the disjoint case, but with strong positives around local
    // alignment boundaries. If extraction reused indices across passes, overlap
    // would be plausible here.
    const boundaryPressureMatrix = Array.from({ length: 11 }, () =>
      Array<number>(11).fill(-Infinity),
    );
    for (let i = 0; i < 3; i++) {
      boundaryPressureMatrix[i][i] = 2;
      boundaryPressureMatrix[i + 4][i + 4] = 4;
      boundaryPressureMatrix[i + 8][i + 8] = 2;
    }
    boundaryPressureMatrix[3][4] = 5;
    boundaryPressureMatrix[4][3] = 5;
    boundaryPressureMatrix[6][7] = 5;
    boundaryPressureMatrix[7][6] = 5;

    it('ensures each local alignment starts and ends with MERGE entries', () => {
      const base = makeIndexedTimeline(disjointMatrix.length, BASE_CLIENT_ID);
      const target = makeIndexedTimeline(
        disjointMatrix[0].length,
        TARGET_CLIENT_ID,
      );

      const result = runAligner(base, target, matrixScorer(disjointMatrix));
      expect(result.alignments.length).toBeGreaterThanOrEqual(2);

      for (const alignment of result.alignments) {
        const first = alignment[0];
        const last = alignment[alignment.length - 1];

        expect(first).toBeDefined();
        expect(last).toBeDefined();
        expect(first.action).toBe(AlignmentAction.MERGE);
        expect(last.action).toBe(AlignmentAction.MERGE);
      }
    });

    it('does not reuse base or target indices across local alignments', () => {
      const base = makeIndexedTimeline(
        boundaryPressureMatrix.length,
        BASE_CLIENT_ID,
      );
      const target = makeIndexedTimeline(
        boundaryPressureMatrix[0].length,
        TARGET_CLIENT_ID,
      );

      const result = runAligner(
        base,
        target,
        matrixScorer(boundaryPressureMatrix),
      );
      expect(result.alignments.length).toBeGreaterThanOrEqual(2);

      const mergesByAlignment = result.alignments.map((alignment) =>
        alignment.filter((entry) => entry.action === AlignmentAction.MERGE),
      );

      let hasBaseOverlap = false;
      let hasTargetOverlap = false;

      for (let i = 0; i < mergesByAlignment.length; i++) {
        for (let j = i + 1; j < mergesByAlignment.length; j++) {
          const baseI = new Set(mergesByAlignment[i].map((m) => m.baseIndex));
          const baseJ = new Set(mergesByAlignment[j].map((m) => m.baseIndex));
          const targetI = new Set(
            mergesByAlignment[i].map((m) => m.targetIndex),
          );
          const targetJ = new Set(
            mergesByAlignment[j].map((m) => m.targetIndex),
          );

          for (const idx of baseI) {
            if (baseJ.has(idx)) {
              hasBaseOverlap = true;
            }
          }
          for (const idx of targetI) {
            if (targetJ.has(idx)) {
              hasTargetOverlap = true;
            }
          }
        }
      }

      expect(hasBaseOverlap).toBe(false);
      expect(hasTargetOverlap).toBe(false);
    });

    it('cannot end on a non-MERGE action', () => {
      const invalidPenaltyMatrix = [
        [-1, 8, -Infinity, 0],
        [10, 10, 0, 5],
        [2, 9, -1, -1],
        [2, -8, -2, -3],
      ];

      const base = makeIndexedTimeline(
        invalidPenaltyMatrix.length,
        BASE_CLIENT_ID,
      );
      const target = makeIndexedTimeline(
        invalidPenaltyMatrix[0].length,
        TARGET_CLIENT_ID,
      );

      const result = new TickAligner(
        base,
        target,
        matrixScorer(invalidPenaltyMatrix),
        {
          minContext: 1,
          minScore: 1,
          minLength: 1,
          gapOpenPenalty: 0,
        },
      ).align();

      expect(result.alignments.length).toBeGreaterThan(0);
      const alignment = result.alignments[0];
      expect(alignment[0].action).toBe(AlignmentAction.MERGE);
      expect(alignment[alignment.length - 1].action).toBe(
        AlignmentAction.MERGE,
      );
    });
  });
});
