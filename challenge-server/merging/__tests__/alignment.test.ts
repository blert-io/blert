import { createPlayerState, createTickState } from './fixtures';
import { TickAligner, SimilarityFn } from '../alignment';
import { TickState, TickStateArray } from '../tick-state';

/**
 * Creates a TickStateArray from tick numbers. Each tick gets a single dummy
 * player so it's non-null.
 */
function makeTimeline(ticks: number[]): TickStateArray {
  return ticks.map((t) =>
    createTickState(t, [createPlayerState({ username: 'player1' })]),
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
 * Converts a mapping to a sorted array of [targetIndex, baseIndex] pairs
 * for easier assertion.
 */
function mappingToArray(mapping: Map<number, number>): [number, number][] {
  return [...mapping.entries()].sort((a, b) => a[0] - b[0]);
}

describe('TickAligner', () => {
  describe('identical timelines', () => {
    it('produces a 1:1 mapping with full coverage', () => {
      const base = makeTimeline([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const target = makeTimeline([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      const result = new TickAligner(base, target, tickMatchScorer()).align();

      expect(mappingToArray(result.mapping)).toEqual([
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
  });

  describe('offset target', () => {
    it('aligns target to the correct region of the base', () => {
      const base = makeTimeline([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const target = makeTimeline([5, 6, 7, 8, 9, 10]);

      const result = new TickAligner(base, target, tickMatchScorer()).align();

      // Target indices 0-5 should map to base indices 4-9.
      expect(mappingToArray(result.mapping)).toEqual([
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
      const base = makeTimeline([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const target = makeTimeline([1, 2, 3, 4, 5]);

      const result = new TickAligner(base, target, tickMatchScorer()).align();

      expect(mappingToArray(result.mapping)).toEqual([
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
    it('bridges across missing ticks', () => {
      // Base has ticks 1-10, target is missing ticks 5-6 due to lag.
      // Target's local tick counter continues from where it left off,
      // so tick 7 in the base appears as tick 5 in the target's counter.
      // But the game state on that tick matches tick 7 in the base.
      const base = makeTimeline([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const target = makeTimeline([1, 2, 3, 4, 7, 8, 9, 10]);

      const result = new TickAligner(base, target, tickMatchScorer()).align();

      // Target indices 0-3 should map to base 0-3.
      // Target indices 4-7 should map to base 6-9.
      // Base indices 4-5 (ticks 5-6) have no match.
      expect(mappingToArray(result.mapping)).toEqual([
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
      expect(result.gapCount).toBeGreaterThan(0);
    });
  });

  describe('no overlap', () => {
    it('returns empty mapping when timelines are disjoint', () => {
      const base = makeTimeline([1, 2, 3, 4, 5]);
      const target = makeTimeline([20, 21, 22, 23, 24]);

      const result = new TickAligner(base, target, tickMatchScorer()).align();

      expect(result.mapping.size).toBe(0);
      expect(result.coverage).toBe(0);
    });
  });

  describe('short sequences', () => {
    it('rejects alignments shorter than MIN_ALIGNMENT_LENGTH', () => {
      const base = makeTimeline([1, 2, 3, 4, 5]);
      const target = makeTimeline([4, 5, 20, 21, 22]);

      const result = new TickAligner(base, target, tickMatchScorer()).align();

      expect(result.mapping.size).toBe(0);
    });

    it('accepts alignments exactly at MIN_ALIGNMENT_LENGTH', () => {
      const base = makeTimeline([1, 2, 3, 4, 5]);
      const target = makeTimeline([3, 4, 5, 20, 21]);

      const result = new TickAligner(base, target, tickMatchScorer()).align();

      expect(result.mapping.size).toBe(3);
    });
  });

  describe('null tick states', () => {
    it('scores null ticks as 0 without breaking the alignment', () => {
      const base = makeTimeline([1, 2, 3, 4, 5, 6, 7]);
      const target: TickStateArray = makeTimeline([1, 2, 3, 4, 5, 6, 7]);
      target[2] = null;
      target[3] = null;

      const result = new TickAligner(base, target, tickMatchScorer()).align();

      // Non-null ticks around the gap should still be aligned.
      expect(result.mapping.has(0)).toBe(true);
      expect(result.mapping.has(1)).toBe(true);
      expect(result.mapping.has(4)).toBe(true);
      expect(result.mapping.has(5)).toBe(true);
      expect(result.mapping.has(6)).toBe(true);

      // Null ticks that appear in the mapping should have a score of 0.
      for (const [targetIdx] of result.mapping) {
        if (target[targetIdx] === null) {
          expect(result.scores.get(targetIdx)).toBe(0);
        }
      }
    });
  });

  describe('scoring', () => {
    it('records per-pair similarity scores', () => {
      const base = makeTimeline([1, 2, 3, 4, 5]);
      const target = makeTimeline([1, 2, 3, 4, 5]);
      const score = 7;

      const result = new TickAligner(
        base,
        target,
        tickMatchScorer(score),
      ).align();

      // Every aligned pair should have the mock score recorded.
      for (const [, pairScore] of result.scores) {
        expect(pairScore).toBe(score);
      }
      expect(result.scores.size).toBe(result.mapping.size);
    });

    it('produces monotonic base indices', () => {
      const base = makeTimeline([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const target = makeTimeline([1, 2, 3, 7, 8, 9, 10]);

      const result = new TickAligner(base, target, tickMatchScorer()).align();

      const baseIndices = [...result.mapping.values()];
      for (let i = 1; i < baseIndices.length; i++) {
        expect(baseIndices[i]).toBeGreaterThan(baseIndices[i - 1]);
      }
    });
  });
});
