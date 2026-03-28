import { AlignmentAction, AlignmentResult } from '../alignment';
import { MergeMapping, TickMapping } from '../tick-mapping';

describe('TickMapping', () => {
  describe('identity', () => {
    it('maps every tick to itself', () => {
      const mapping = TickMapping.identity(5);
      for (let i = 0; i < 5; i++) {
        expect(mapping.toMerged(i)).toBe(i);
        expect(mapping.toClient(i)).toBe(i);
      }
    });

    it('returns undefined for out-of-range ticks', () => {
      const mapping = TickMapping.identity(3);
      expect(mapping.toMerged(3)).toBeUndefined();
      expect(mapping.toClient(3)).toBeUndefined();
    });
  });

  describe('fromAlignment', () => {
    it('maps ticks correctly with an INSERT', () => {
      // base:   0,1,_,2,3,4
      // target: 0,1,2,3,4,5
      const alignment: AlignmentResult = {
        alignments: [
          [
            {
              action: AlignmentAction.MERGE,
              baseIndex: 0,
              targetIndex: 0,
              score: 1,
            },
            {
              action: AlignmentAction.MERGE,
              baseIndex: 1,
              targetIndex: 1,
              score: 1,
            },
            { action: AlignmentAction.INSERT, targetIndex: 2 },
            {
              action: AlignmentAction.MERGE,
              baseIndex: 2,
              targetIndex: 3,
              score: 1,
            },
            {
              action: AlignmentAction.MERGE,
              baseIndex: 3,
              targetIndex: 4,
              score: 1,
            },
            {
              action: AlignmentAction.MERGE,
              baseIndex: 4,
              targetIndex: 5,
              score: 1,
            },
          ],
        ],
        coverage: 0.8,
        gapCount: 1,
      };

      const result = TickMapping.fromAlignment(5, 5, alignment);
      expect(result.mergedTickCount).toBe(6);

      expect(result.base.toMerged(0)).toBe(0);
      expect(result.base.toMerged(1)).toBe(1);
      expect(result.base.toMerged(2)).toBe(3);
      expect(result.base.toMerged(3)).toBe(4);
      expect(result.base.toMerged(4)).toBe(5);
      expect(result.base.toMerged(5)).toBeUndefined();

      expect(result.target.toMerged(0)).toBe(0);
      expect(result.target.toMerged(1)).toBe(1);
      expect(result.target.toMerged(2)).toBe(2);
      expect(result.target.toMerged(3)).toBe(3);
      expect(result.target.toMerged(4)).toBe(4);
      expect(result.target.toMerged(5)).toBe(5);

      expect(result.base.toClient(0)).toBe(0);
      expect(result.base.toClient(1)).toBe(1);
      expect(result.base.toClient(2)).toBeUndefined();
      expect(result.base.toClient(3)).toBe(2);
      expect(result.base.toClient(4)).toBe(3);
      expect(result.base.toClient(5)).toBe(4);
    });

    it('maps ticks correctly with a KEEP', () => {
      // base:   0,1,2,3
      // target: 0,_,1,2
      const alignment: AlignmentResult = {
        alignments: [
          [
            {
              action: AlignmentAction.MERGE,
              baseIndex: 0,
              targetIndex: 0,
              score: 1,
            },
            { action: AlignmentAction.KEEP, baseIndex: 1 },
            {
              action: AlignmentAction.MERGE,
              baseIndex: 2,
              targetIndex: 1,
              score: 1,
            },
            {
              action: AlignmentAction.MERGE,
              baseIndex: 3,
              targetIndex: 2,
              score: 1,
            },
          ],
        ],
        coverage: 0.75,
        gapCount: 1,
      };

      const result = TickMapping.fromAlignment(4, 3, alignment);
      expect(result.mergedTickCount).toBe(4);

      expect(result.base.toMerged(0)).toBe(0);
      expect(result.base.toMerged(1)).toBe(1);
      expect(result.base.toMerged(2)).toBe(2);
      expect(result.base.toMerged(3)).toBe(3);

      expect(result.target.toMerged(0)).toBe(0);
      expect(result.target.toMerged(1)).toBe(2);
      expect(result.target.toMerged(2)).toBe(3);

      expect(result.target.toClient(1)).toBeUndefined();
    });

    it('handles base ticks before and after the alignment', () => {
      // base:   0,1,2,3,4,5
      // target: _,_,0,1,_,_
      const alignment: AlignmentResult = {
        alignments: [
          [
            {
              action: AlignmentAction.MERGE,
              baseIndex: 2,
              targetIndex: 0,
              score: 1,
            },
            {
              action: AlignmentAction.MERGE,
              baseIndex: 3,
              targetIndex: 1,
              score: 1,
            },
          ],
        ],
        coverage: 1 / 3,
        gapCount: 0,
      };

      const result = TickMapping.fromAlignment(6, 2, alignment);
      expect(result.mergedTickCount).toBe(6);

      expect(result.base.toMerged(0)).toBe(0);
      expect(result.base.toMerged(1)).toBe(1);
      expect(result.base.toMerged(2)).toBe(2);
      expect(result.base.toMerged(3)).toBe(3);
      expect(result.base.toMerged(4)).toBe(4);
      expect(result.base.toMerged(5)).toBe(5);

      expect(result.target.toMerged(0)).toBe(2);
      expect(result.target.toMerged(1)).toBe(3);
    });

    it('exposes clientTickCount', () => {
      const result = TickMapping.fromAlignment(6, 3, {
        alignments: [
          [
            {
              action: AlignmentAction.MERGE,
              baseIndex: 0,
              targetIndex: 0,
              score: 1,
            },
            {
              action: AlignmentAction.MERGE,
              baseIndex: 1,
              targetIndex: 1,
              score: 1,
            },
          ],
        ],
        coverage: 1 / 3,
        gapCount: 0,
      });

      expect(result.base.clientTickCount).toBe(6);
      expect(result.target.clientTickCount).toBe(3);
    });
  });
});

describe('MergeMapping', () => {
  // Simulate a three-client merge: A (base), B (step 1), C (step 2).
  //
  // Step 1: A(5 ticks) + B(5 ticks), identity alignment.
  //
  // Step 2: Merged(5 ticks) + C(5 ticks), aligned with INSERT at position 2.
  //   Merged ticks: 0,1,2,3,4,_
  //   C ticks:      _,0,1,2,3,4
  //   Alignment: merge(0,0), merge(1,1), insert(C:2), merge(2,3), merge(3,4)

  const CLIENT_A = 1;
  const CLIENT_B = 2;
  const CLIENT_C = 3;

  function buildStep1Mappings() {
    return {
      base: TickMapping.identity(5),
      target: TickMapping.identity(5),
    };
  }

  function buildStep2Mappings() {
    const alignment: AlignmentResult = {
      alignments: [
        [
          {
            action: AlignmentAction.MERGE,
            baseIndex: 0,
            targetIndex: 0,
            score: 1,
          },
          {
            action: AlignmentAction.MERGE,
            baseIndex: 1,
            targetIndex: 1,
            score: 1,
          },
          { action: AlignmentAction.INSERT, targetIndex: 2 },
          {
            action: AlignmentAction.MERGE,
            baseIndex: 2,
            targetIndex: 3,
            score: 1,
          },
          {
            action: AlignmentAction.MERGE,
            baseIndex: 3,
            targetIndex: 4,
            score: 1,
          },
        ],
      ],
      coverage: 0.8,
      gapCount: 1,
    };
    const result = TickMapping.fromAlignment(5, 5, alignment);
    return { base: result.base, target: result.target };
  }

  describe('resolveClientTick', () => {
    it('resolves the base client through the full chain', () => {
      const mm = new MergeMapping(CLIENT_A);

      const step1 = buildStep1Mappings();
      mm.begin(CLIENT_B, step1.base, step1.target, 5);
      mm.commit();

      const step2 = buildStep2Mappings();
      mm.begin(CLIENT_C, step2.base, step2.target, 6);
      mm.commit();

      expect(mm.resolveClientTick(0, CLIENT_A)).toBe(0);
      expect(mm.resolveClientTick(3, CLIENT_A)).toBe(2);
      expect(mm.resolveClientTick(5, CLIENT_A)).toBe(4);
    });

    it('resolves a step-1 target through the chain', () => {
      const mm = new MergeMapping(CLIENT_A);

      const step1 = buildStep1Mappings();
      mm.begin(CLIENT_B, step1.base, step1.target, 5);
      mm.commit();

      const step2 = buildStep2Mappings();
      mm.begin(CLIENT_C, step2.base, step2.target, 6);
      mm.commit();

      expect(mm.resolveClientTick(0, CLIENT_B)).toBe(0);
      expect(mm.resolveClientTick(3, CLIENT_B)).toBe(2);
      expect(mm.resolveClientTick(5, CLIENT_B)).toBe(4);
    });

    it('resolves the latest target directly', () => {
      const mm = new MergeMapping(CLIENT_A);

      const step1 = buildStep1Mappings();
      mm.begin(CLIENT_B, step1.base, step1.target, 5);
      mm.commit();

      const step2 = buildStep2Mappings();
      mm.begin(CLIENT_C, step2.base, step2.target, 6);
      mm.commit();

      expect(mm.resolveClientTick(2, CLIENT_C)).toBe(2);
      expect(mm.resolveClientTick(0, CLIENT_C)).toBe(0);
    });

    it('returns undefined for an unknown client', () => {
      const mm = new MergeMapping(CLIENT_A);
      const step1 = buildStep1Mappings();
      mm.begin(CLIENT_B, step1.base, step1.target, 5);
      mm.commit();

      expect(mm.resolveClientTick(0, 999)).toBeUndefined();
    });

    it('returns undefined when a tick has no mapping in the chain', () => {
      const mm = new MergeMapping(CLIENT_A);

      const step2 = buildStep2Mappings();
      mm.begin(CLIENT_C, step2.base, step2.target, 6);
      mm.commit();

      // Tick 2 was inserted from C, it has no mapping in the other clients.
      expect(mm.resolveClientTick(2, CLIENT_A)).toBeUndefined();
      expect(mm.resolveClientTick(2, CLIENT_B)).toBeUndefined();
      expect(mm.resolveClientTick(2, CLIENT_C)).toBe(2);
    });
  });

  describe('in-flight entry', () => {
    it('participates in resolution before commit', () => {
      const mm = new MergeMapping(CLIENT_A);

      const step1 = buildStep1Mappings();
      mm.begin(CLIENT_B, step1.base, step1.target, 5);

      expect(mm.resolveClientTick(2, CLIENT_B)).toBe(2);
      expect(mm.resolveClientTick(2, CLIENT_A)).toBe(2);
    });

    it('is cleared by discard', () => {
      const mm = new MergeMapping(CLIENT_A);

      const step1 = buildStep1Mappings();
      mm.begin(CLIENT_B, step1.base, step1.target, 5);
      mm.discard();

      expect(mm.resolveClientTick(0, CLIENT_B)).toBeUndefined();
      expect(mm.resolveClientTick(0, CLIENT_A)).toBe(0);
    });

    it('moves to the committed chain on commit', () => {
      const mm = new MergeMapping(CLIENT_A);

      const step1 = buildStep1Mappings();
      mm.begin(CLIENT_B, step1.base, step1.target, 5);
      mm.commit();

      // Begin a new in-flight for C.
      const step2 = buildStep2Mappings();
      mm.begin(CLIENT_C, step2.base, step2.target, 6);
      expect(mm.resolveClientTick(4, CLIENT_B)).toBe(3);
      expect(mm.resolveClientTick(2, CLIENT_A)).toBeUndefined();
      expect(mm.resolveClientTick(2, CLIENT_B)).toBeUndefined();
      expect(mm.resolveClientTick(2, CLIENT_C)).toBe(2);
    });
  });
});
