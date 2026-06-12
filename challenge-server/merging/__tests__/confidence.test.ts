import {
  Alignment,
  AlignmentAction,
  AlignmentRange,
  AlignmentResult,
  LocalAlignment,
} from '../alignment';
import {
  countMonotoneMatchings,
  DEFAULT_CONFIDENCE_WEIGHTS,
  partitionAlignment,
  scoreStepConfidence,
  Segment,
  segmentBonusSupport,
  segmentDiscriminability,
} from '../confidence';
import { ReconciliationCounters } from '../event-consolidator';
import { QualityFlag } from '../quality';

const MERGE = AlignmentAction.MERGE;
const KEEP = AlignmentAction.KEEP;

/**
 * Builds a similarity matrix where cells listed in `compatible` are finite
 * (value 1) and all others are -Infinity.
 */
function buildSimilarity(
  range: AlignmentRange,
  compatible: [number, number][],
): Float64Array[] {
  const rows = range.baseEnd - range.baseStart;
  const cols = range.targetEnd - range.targetStart;
  const matrix: Float64Array[] = [];
  for (let i = 0; i < rows; i++) {
    matrix.push(new Float64Array(cols).fill(-Infinity));
  }
  for (const [b, t] of compatible) {
    matrix[b - range.baseStart][t - range.targetStart] = 1;
  }
  return matrix;
}

/** Wraps a 2D number array as the Float64Array rows the aligner produces. */
function grid(rows: number[][]): Float64Array[] {
  return rows.map((r) => Float64Array.from(r));
}

function makeLocalAlignment(
  entries: Alignment,
  range: AlignmentRange,
  compatible: [number, number][],
  margin?: Float64Array[],
  nulls?: { baseNull?: number[]; targetNull?: number[] },
): LocalAlignment {
  const similarity = buildSimilarity(range, compatible);
  const rows = range.baseEnd - range.baseStart;
  const cols = range.targetEnd - range.targetStart;
  return {
    entries,
    range,
    similarity,
    margin:
      margin ?? Array.from({ length: rows }, () => new Float64Array(cols)),
    baseNull: new Set(nulls?.baseNull ?? []),
    targetNull: new Set(nulls?.targetNull ?? []),
  };
}

describe('partitionAlignment', () => {
  it('classifies all merges as anchors when every tick has plateau 1', () => {
    const la = makeLocalAlignment(
      [
        { action: MERGE, baseIndex: 0, targetIndex: 0, score: 5 },
        { action: MERGE, baseIndex: 1, targetIndex: 1, score: 5 },
        { action: MERGE, baseIndex: 2, targetIndex: 2, score: 5 },
      ],
      { baseStart: 0, baseEnd: 3, targetStart: 0, targetEnd: 3 },
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
    );

    expect(partitionAlignment(la)).toEqual([
      { kind: 'anchor', baseIndex: 0, targetIndex: 0 },
      { kind: 'anchor', baseIndex: 1, targetIndex: 1 },
      { kind: 'anchor', baseIndex: 2, targetIndex: 2 },
    ]);
  });

  it('groups a run of ambiguous merges into a single segment', () => {
    // Each base tick is compatible with two adjacent target ticks (plateau 2).
    const entries: Alignment = [
      { action: MERGE, baseIndex: 0, targetIndex: 0, score: 3 },
      { action: MERGE, baseIndex: 1, targetIndex: 1, score: 3 },
      { action: MERGE, baseIndex: 2, targetIndex: 2, score: 3 },
    ];
    const la = makeLocalAlignment(
      entries,
      { baseStart: 0, baseEnd: 3, targetStart: 0, targetEnd: 4 },
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 2],
        [2, 2],
        [2, 3],
      ],
    );

    expect(partitionAlignment(la)).toEqual([
      {
        kind: 'segment',
        entries,
        region: { baseStart: 0, baseEnd: 3, targetStart: 0, targetEnd: 4 },
      },
    ]);
  });

  it('splits anchors and a segment in a mixed alignment', () => {
    // Ticks 0,1 unique (anchors); 2,3 share plateaus; 4 unique (anchor).
    const entries: Alignment = [
      { action: MERGE, baseIndex: 0, targetIndex: 0, score: 5 },
      { action: MERGE, baseIndex: 1, targetIndex: 1, score: 5 },
      { action: MERGE, baseIndex: 2, targetIndex: 2, score: 3 },
      { action: MERGE, baseIndex: 3, targetIndex: 3, score: 3 },
      { action: MERGE, baseIndex: 4, targetIndex: 4, score: 5 },
    ];
    const la = makeLocalAlignment(
      entries,
      { baseStart: 0, baseEnd: 5, targetStart: 0, targetEnd: 5 },
      [
        [0, 0],
        [1, 1],
        [2, 2],
        [2, 3],
        [3, 2],
        [3, 3],
        [4, 4],
      ],
    );

    expect(partitionAlignment(la)).toEqual([
      { kind: 'anchor', baseIndex: 0, targetIndex: 0 },
      { kind: 'anchor', baseIndex: 1, targetIndex: 1 },
      {
        kind: 'segment',
        entries: [
          { action: MERGE, baseIndex: 2, targetIndex: 2, score: 3 },
          { action: MERGE, baseIndex: 3, targetIndex: 3, score: 3 },
        ],
        region: { baseStart: 2, baseEnd: 4, targetStart: 2, targetEnd: 4 },
      },
      { kind: 'anchor', baseIndex: 4, targetIndex: 4 },
    ]);
  });

  it('translates indices by the range offset when reading plateaus', () => {
    // Base 10 / target 20 maps to similarity cell [0][0].
    // Anchor, 2 plateau ambiguous merge, anchor.
    const entries: Alignment = [
      { action: MERGE, baseIndex: 10, targetIndex: 20, score: 5 },
      { action: MERGE, baseIndex: 11, targetIndex: 21, score: 3 },
      { action: MERGE, baseIndex: 12, targetIndex: 22, score: 3 },
      { action: MERGE, baseIndex: 13, targetIndex: 23, score: 5 },
    ];
    const la = makeLocalAlignment(
      entries,
      { baseStart: 10, baseEnd: 14, targetStart: 20, targetEnd: 25 },
      [
        [10, 20],
        [11, 21],
        [11, 22],
        [12, 22],
        [12, 23],
        [13, 23],
      ],
    );

    expect(partitionAlignment(la)).toEqual([
      { kind: 'anchor', baseIndex: 10, targetIndex: 20 },
      {
        kind: 'segment',
        entries: [
          { action: MERGE, baseIndex: 11, targetIndex: 21, score: 3 },
          { action: MERGE, baseIndex: 12, targetIndex: 22, score: 3 },
        ],
        region: { baseStart: 11, baseEnd: 13, targetStart: 21, targetEnd: 23 },
      },
      { kind: 'anchor', baseIndex: 13, targetIndex: 23 },
    ]);
  });

  it('includes a gap interleaved between two ambiguous merges', () => {
    // Ambiguous merge, KEEP, ambiguous merge.
    const entries: Alignment = [
      { action: MERGE, baseIndex: 0, targetIndex: 0, score: 3 },
      { action: KEEP, baseIndex: 1 },
      { action: MERGE, baseIndex: 2, targetIndex: 1, score: 3 },
    ];
    const la = makeLocalAlignment(
      entries,
      { baseStart: 0, baseEnd: 3, targetStart: 0, targetEnd: 3 },
      [
        [0, 0],
        [0, 1],
        [2, 1],
        [2, 2],
      ],
    );

    expect(partitionAlignment(la)).toEqual([
      {
        kind: 'segment',
        entries,
        region: { baseStart: 0, baseEnd: 3, targetStart: 0, targetEnd: 3 },
      },
    ]);
  });

  it('drops a gap pinned between two anchors', () => {
    const la = makeLocalAlignment(
      [
        { action: MERGE, baseIndex: 0, targetIndex: 0, score: 5 },
        { action: KEEP, baseIndex: 1 },
        { action: MERGE, baseIndex: 2, targetIndex: 1, score: 5 },
      ],
      { baseStart: 0, baseEnd: 3, targetStart: 0, targetEnd: 2 },
      [
        [0, 0],
        [2, 1],
      ],
    );

    expect(partitionAlignment(la)).toEqual([
      { kind: 'anchor', baseIndex: 0, targetIndex: 0 },
      { kind: 'anchor', baseIndex: 2, targetIndex: 1 },
    ]);
  });

  it('trims leading and trailing gaps from a segment', () => {
    // Anchor, KEEP (trailing the anchor), ambiguous merge x2, KEEP (leading
    // the next anchor), anchor. Only the ambiguous merges form the segment.
    const entries: Alignment = [
      { action: MERGE, baseIndex: 0, targetIndex: 0, score: 5 },
      { action: KEEP, baseIndex: 1 },
      { action: MERGE, baseIndex: 2, targetIndex: 1, score: 3 },
      { action: MERGE, baseIndex: 3, targetIndex: 2, score: 3 },
      { action: KEEP, baseIndex: 4 },
      { action: MERGE, baseIndex: 5, targetIndex: 3, score: 5 },
    ];
    const la = makeLocalAlignment(
      entries,
      { baseStart: 0, baseEnd: 6, targetStart: 0, targetEnd: 4 },
      [
        [0, 0],
        [2, 1],
        [2, 2],
        [3, 1],
        [3, 2],
        [5, 3],
      ],
    );

    expect(partitionAlignment(la)).toEqual([
      { kind: 'anchor', baseIndex: 0, targetIndex: 0 },
      {
        kind: 'segment',
        entries: [
          { action: MERGE, baseIndex: 2, targetIndex: 1, score: 3 },
          { action: MERGE, baseIndex: 3, targetIndex: 2, score: 3 },
        ],
        region: { baseStart: 1, baseEnd: 5, targetStart: 1, targetEnd: 3 },
      },
      { kind: 'anchor', baseIndex: 5, targetIndex: 3 },
    ]);
  });

  it('treats a null merge as a gap, not an anchor', () => {
    const la = makeLocalAlignment(
      [
        { action: MERGE, baseIndex: 0, targetIndex: 0, score: 5 },
        { action: MERGE, baseIndex: 1, targetIndex: 1, score: 0 },
        { action: MERGE, baseIndex: 2, targetIndex: 2, score: 5 },
      ],
      { baseStart: 0, baseEnd: 3, targetStart: 0, targetEnd: 3 },
      [
        [0, 0],
        // A null base row reads as compatible with every target tick.
        [1, 0],
        [1, 1],
        [1, 2],
        [2, 2],
      ],
      undefined,
      { baseNull: [1] },
    );

    expect(partitionAlignment(la)).toEqual([
      { kind: 'anchor', baseIndex: 0, targetIndex: 0 },
      { kind: 'anchor', baseIndex: 2, targetIndex: 2 },
    ]);
  });
});

describe('countMonotoneMatchings', () => {
  /** All cells of a rows by cols rectangle. */
  function rectangle(rows: number, cols: number): [number, number][] {
    const cells: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push([r, c]);
      }
    }
    return cells;
  }

  it('returns 1 for a square fully-compatible region', () => {
    expect(countMonotoneMatchings(rectangle(5, 5), 5)).toBe(1);
  });

  it('returns C(cols, size) for a wider compatible region', () => {
    expect(countMonotoneMatchings(rectangle(5, 4), 4)).toBe(5); // C(5,4)
    expect(countMonotoneMatchings(rectangle(5, 7), 5)).toBe(21); // C(7,5)
  });

  it('counts each cell once for a single match', () => {
    // size 1: every compatible cell is its own placement.
    expect(countMonotoneMatchings(rectangle(1, 4), 1)).toBe(4);
    expect(countMonotoneMatchings(rectangle(3, 3), 1)).toBe(9);
  });

  it('returns 0 when size exceeds the available rows or columns', () => {
    expect(countMonotoneMatchings(rectangle(3, 5), 4)).toBe(0);
    expect(countMonotoneMatchings(rectangle(5, 3), 4)).toBe(0);
  });

  it('avoids holes in a region', () => {
    // 3x3 minus the (1,1) center; no way to fit a size of 3.
    const cells = rectangle(3, 3).filter(([r, c]) => !(r === 1 && c === 1));
    expect(countMonotoneMatchings(cells, 3)).toBe(0);
  });

  it('counts diagonals around a hole in a wider region', () => {
    // 3x4 minus (1,1): the full count is C(4,3) = 4, but two of them pass
    // through (1,1).
    const cells = rectangle(3, 4).filter(([r, c]) => !(r === 1 && c === 1));
    expect(countMonotoneMatchings(cells, 3)).toBe(2);
  });

  it('returns 1 for the empty matching and 0 for negative sizes', () => {
    expect(countMonotoneMatchings(rectangle(3, 3), 0)).toBe(1);
    expect(countMonotoneMatchings(rectangle(3, 3), -1)).toBe(0);
  });
});

describe('segmentDiscriminability', () => {
  function expectSingleSegment(la: LocalAlignment): Segment {
    const segments = partitionAlignment(la).filter((p) => p.kind === 'segment');
    expect(segments).toHaveLength(1);
    return segments[0];
  }

  it('scores 1 for a square, fully compatible segment', () => {
    const entries: Alignment = [
      { action: MERGE, baseIndex: 0, targetIndex: 0, score: 3 },
      { action: MERGE, baseIndex: 1, targetIndex: 1, score: 3 },
      { action: MERGE, baseIndex: 2, targetIndex: 2, score: 3 },
    ];
    const la = makeLocalAlignment(
      entries,
      { baseStart: 0, baseEnd: 3, targetStart: 0, targetEnd: 3 },
      [
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 0],
        [1, 1],
        [1, 2],
        [2, 0],
        [2, 1],
        [2, 2],
      ],
    );

    expect(segmentDiscriminability(la, expectSingleSegment(la))).toBe(1);
  });

  it('scores 1/C(cols, k) for a wider fully compatible region', () => {
    const compatible: [number, number][] = [[0, 0]];
    for (let b = 1; b <= 5; b++) {
      for (let t = 1; t <= 7; t++) {
        compatible.push([b, t]);
      }
    }
    compatible.push([6, 8]);

    const entries: Alignment = [
      { action: MERGE, baseIndex: 0, targetIndex: 0, score: 5 },
      { action: MERGE, baseIndex: 1, targetIndex: 1, score: 1 },
      { action: MERGE, baseIndex: 2, targetIndex: 2, score: 1 },
      { action: MERGE, baseIndex: 3, targetIndex: 3, score: 1 },
      { action: MERGE, baseIndex: 4, targetIndex: 4, score: 1 },
      { action: MERGE, baseIndex: 5, targetIndex: 5, score: 1 },
      { action: MERGE, baseIndex: 6, targetIndex: 8, score: 5 },
    ];
    const la = makeLocalAlignment(
      entries,
      { baseStart: 0, baseEnd: 7, targetStart: 0, targetEnd: 9 },
      compatible,
    );

    expect(segmentDiscriminability(la, expectSingleSegment(la))).toBeCloseTo(
      1 / 21,
    );
  });

  it('excludes null rows and null merges from the region', () => {
    // A 2x3 ambiguous block of 3 monotone paths, ignoring the null row which
    // would make it 9.
    const la = makeLocalAlignment(
      [
        { action: MERGE, baseIndex: 0, targetIndex: 0, score: 0 },
        { action: MERGE, baseIndex: 1, targetIndex: 1, score: 1 },
        { action: MERGE, baseIndex: 2, targetIndex: 2, score: 1 },
      ],
      { baseStart: 0, baseEnd: 3, targetStart: 0, targetEnd: 4 },
      [
        [0, 0],
        [0, 1],
        [0, 2],
        [0, 3],
        [1, 1],
        [1, 2],
        [1, 3],
        [2, 1],
        [2, 2],
        [2, 3],
      ],
      undefined,
      { baseNull: [0] },
    );
    const segment: Segment = {
      kind: 'segment',
      entries: la.entries,
      region: { baseStart: 0, baseEnd: 3, targetStart: 1, targetEnd: 4 },
    };

    expect(segmentDiscriminability(la, segment)).toBeCloseTo(1 / 3);
  });

  it('falls back to a closed form on a region too large to enumerate', () => {
    // A 64x64 fully compatible block with a 64-merge diagonal. Rather than
    // using the O(64^5) exact path count DP, the closed form is used.
    const SIZE = 64;
    const entries: Alignment = [];
    const compatible: [number, number][] = [];
    for (let i = 0; i < SIZE; i++) {
      entries.push({ action: MERGE, baseIndex: i, targetIndex: i, score: 1 });
      for (let j = 0; j < SIZE; j++) {
        compatible.push([i, j]);
      }
    }
    const range = {
      baseStart: 0,
      baseEnd: SIZE,
      targetStart: 0,
      targetEnd: SIZE,
    };
    const la = makeLocalAlignment(entries, range, compatible);
    const segment: Segment = { kind: 'segment', entries, region: range };

    expect(segmentDiscriminability(la, segment)).toBe(1);
  });

  it('bounds an edge segment by its merges, ignoring a far compatible void', () => {
    // Three plateau-2 merges at ticks 10-12 inside a much larger search range.
    // A compatible diagonal at 0-9 sits in the unaligned void below them.
    // Only the merge region should be considered.
    const entries: Alignment = [
      { action: MERGE, baseIndex: 10, targetIndex: 10, score: 3 },
      { action: MERGE, baseIndex: 11, targetIndex: 11, score: 3 },
      { action: MERGE, baseIndex: 12, targetIndex: 12, score: 3 },
    ];
    const voidDiagonal = Array.from(
      { length: 10 },
      (_, i): [number, number] => [i, i],
    );
    const la = makeLocalAlignment(
      entries,
      { baseStart: 0, baseEnd: 20, targetStart: 0, targetEnd: 20 },
      [
        ...voidDiagonal,
        [10, 10],
        [10, 11],
        [11, 11],
        [11, 12],
        [12, 12],
        [12, 13],
      ],
    );

    const segment = expectSingleSegment(la);
    expect(segment.region).toEqual({
      baseStart: 10,
      baseEnd: 13,
      targetStart: 10,
      targetEnd: 14,
    });
    expect(segmentDiscriminability(la, segment)).toBeCloseTo(1 / 4);
  });
});

describe('segmentBonusSupport', () => {
  const SCALE = 5;
  const TEMP = 0.1;

  function segment(entries: Alignment): Segment {
    return {
      kind: 'segment',
      entries,
      region: { baseStart: 0, baseEnd: 0, targetStart: 0, targetEnd: 0 },
    };
  }

  const RANGE: AlignmentRange = {
    baseStart: 0,
    baseEnd: 3,
    targetStart: 0,
    targetEnd: 3,
  };
  const DIAGONAL: Alignment = [
    { action: MERGE, baseIndex: 0, targetIndex: 0, score: 3 },
    { action: MERGE, baseIndex: 1, targetIndex: 1, score: 3 },
    { action: MERGE, baseIndex: 2, targetIndex: 2, score: 3 },
  ];

  function diagonalMargins(...diagonal: number[]): Float64Array[] {
    return diagonal.map((m, i) => {
      const row = new Float64Array(diagonal.length);
      row[i] = m;
      return row;
    });
  }

  it('scores zero when no step is decisive', () => {
    // Every step is a perfect tie (margin 0) so there is no support.
    const la = makeLocalAlignment(
      DIAGONAL,
      RANGE,
      [],
      diagonalMargins(0, 0, 0),
    );
    expect(segmentBonusSupport(la, segment(DIAGONAL), SCALE, TEMP)).toBeCloseTo(
      0,
    );
  });

  it('approaches one when every step is decisive', () => {
    const la = makeLocalAlignment(
      DIAGONAL,
      RANGE,
      [],
      diagonalMargins(50, 50, 50),
    );
    expect(
      segmentBonusSupport(la, segment(DIAGONAL), SCALE, TEMP),
    ).toBeGreaterThan(0.99);
  });

  it('increases monotonically with the per-step margin', () => {
    const weak = makeLocalAlignment(
      DIAGONAL,
      RANGE,
      [],
      diagonalMargins(2, 2, 2),
    );
    const strong = makeLocalAlignment(
      DIAGONAL,
      RANGE,
      [],
      diagonalMargins(20, 20, 20),
    );
    expect(
      segmentBonusSupport(strong, segment(DIAGONAL), SCALE, TEMP),
    ).toBeGreaterThan(
      segmentBonusSupport(weak, segment(DIAGONAL), SCALE, TEMP),
    );
  });

  it('collapses toward the weakest step instead of averaging', () => {
    // Per-step supports are [~1, 0, ~1] so the arithmetic mean is 0.67, but the
    // score should be dragged down beyond that by the weak step.
    const la = makeLocalAlignment(
      DIAGONAL,
      RANGE,
      [],
      diagonalMargins(50, 0, 50),
    );
    const support = segmentBonusSupport(la, segment(DIAGONAL), SCALE, TEMP);
    expect(support).toBeLessThan(0.2);
    expect(support).toBeGreaterThan(0);
  });

  it('reads the margin at the cell each gap step occupies', () => {
    // (1,1) is not part of the alignment so it should be ignored.
    const entries: Alignment = [
      { action: MERGE, baseIndex: 0, targetIndex: 0, score: 3 },
      { action: KEEP, baseIndex: 1 }, // (1, 0)
      { action: MERGE, baseIndex: 2, targetIndex: 1, score: 3 },
    ];
    const margin = grid([
      [50, 0],
      [0, 50],
      [0, 50],
    ]);
    const la = makeLocalAlignment(
      entries,
      { baseStart: 0, baseEnd: 3, targetStart: 0, targetEnd: 2 },
      [],
      margin,
    );

    expect(segmentBonusSupport(la, segment(entries), SCALE, TEMP)).toBeLessThan(
      0.2,
    );
  });

  it('skips a null merge when measuring support', () => {
    // The middle merge is a null fill (base tick 1); its zero margin would
    // reduce the support if counted. Skipping it leaves two decisive merges.
    const entries: Alignment = [
      { action: MERGE, baseIndex: 0, targetIndex: 0, score: 3 },
      { action: MERGE, baseIndex: 1, targetIndex: 1, score: 0 },
      { action: MERGE, baseIndex: 2, targetIndex: 2, score: 3 },
    ];
    const la = makeLocalAlignment(
      entries,
      RANGE,
      [],
      diagonalMargins(50, 0, 50),
      { baseNull: [1] },
    );

    expect(
      segmentBonusSupport(la, segment(entries), SCALE, TEMP),
    ).toBeGreaterThan(0.99);
  });

  it('subtracts the baseline weight from merge-cell margins', () => {
    const la = makeLocalAlignment(
      DIAGONAL,
      RANGE,
      [],
      diagonalMargins(9, 9, 9),
    );

    // Margin 9 minus a baseline of 4 leaves an effective margin of 5,
    // which maps to 1 - e^(-5 / SCALE).
    expect(
      segmentBonusSupport(la, segment(DIAGONAL), SCALE, TEMP, 4),
    ).toBeCloseTo(0.632, 3);

    // Without baseline subtraction, the support is much stronger.
    expect(
      segmentBonusSupport(la, segment(DIAGONAL), SCALE, TEMP, 0),
    ).toBeGreaterThan(0.8);
  });

  it('does not subtract the baseline from gap-cell margins', () => {
    const entries: Alignment = [
      { action: MERGE, baseIndex: 0, targetIndex: 0, score: 3 },
      { action: KEEP, baseIndex: 1 }, // (1, 0)
      { action: MERGE, baseIndex: 2, targetIndex: 1, score: 3 },
    ];
    // The KEEP gap occupies the weakest (binding) cell; the merges are strong.
    const margin = grid([
      [50, 0],
      [5, 0],
      [0, 50],
    ]);
    const la = makeLocalAlignment(
      entries,
      { baseStart: 0, baseEnd: 3, targetStart: 0, targetEnd: 2 },
      [],
      margin,
    );

    // The baseline only applies to merge cells.
    expect(
      segmentBonusSupport(la, segment(entries), SCALE, TEMP, 4),
    ).toBeCloseTo(segmentBonusSupport(la, segment(entries), SCALE, TEMP, 0));
  });
});

describe('scoreStepConfidence', () => {
  const NO_COUNTERS: ReconciliationCounters = {
    playerAttacks: 0,
    playerSpells: 0,
    npcAttacks: 0,
    streamEventPairs: 0,
    attackMappedEvents: 0,
  };

  /** A fully anchored alignment of `length` unique 1:1 merges. */
  function anchoredAlignment(
    length: number,
    targetCoverage: number,
  ): AlignmentResult {
    const entries: Alignment = [];
    const compatible: [number, number][] = [];
    for (let i = 0; i < length; i++) {
      entries.push({ action: MERGE, baseIndex: i, targetIndex: i, score: 3 });
      compatible.push([i, i]);
    }
    const la = makeLocalAlignment(
      entries,
      { baseStart: 0, baseEnd: length, targetStart: 0, targetEnd: length },
      compatible,
    );
    return { alignments: [la], baseCoverage: 1, targetCoverage, gapCount: 0 };
  }

  function attackTypeMismatch(tick: number): QualityFlag {
    return {
      kind: 'ATTACK_TYPE_MISMATCH',
      tick,
      player: 'p1',
      keptType: 1,
      discardedType: 2,
      keptSourceClientId: 1,
      discardedSourceClientId: 2,
    };
  }

  it('returns full confidence for an identity step', () => {
    const result = scoreStepConfidence(null, NO_COUNTERS, []);
    expect(result.structural.identity).toBe(true);
    expect(result.structural.value).toBe(1);
    expect(result.content.value).toBe(1);
    expect(result.overall).toBe(1);
  });

  it('fully scores a clean conflict-free alignment', () => {
    const short = scoreStepConfidence(anchoredAlignment(4, 1), NO_COUNTERS, []);
    expect(short.structural.identity).toBe(false);
    expect(short.structural.segments).toEqual([]);
    expect(short.structural.value).toBe(1);
    expect(short.overall).toBe(1);

    const long = scoreStepConfidence(anchoredAlignment(40, 1), NO_COUNTERS, []);
    expect(long.structural.identity).toBe(false);
    expect(long.structural.segments).toEqual([]);
    expect(long.structural.value).toBe(1);
    expect(long.overall).toBe(1);
  });

  it('scales structural confidence linearly with target coverage', () => {
    const full = scoreStepConfidence(anchoredAlignment(40, 1), NO_COUNTERS, []);
    const half = scoreStepConfidence(
      anchoredAlignment(40, 0.5),
      NO_COUNTERS,
      [],
    );
    expect(half.structural.value).toBeCloseTo(full.structural.value * 0.5);
    expect(half.structural.targetCoverage).toBe(0.5);
  });

  it('penalizes content conflicts and blends them with structure', () => {
    // One mismatch over four reconciliation attempts on an otherwise clean
    // identity step.
    const counters: ReconciliationCounters = {
      ...NO_COUNTERS,
      playerAttacks: 4,
    };
    const result = scoreStepConfidence(null, counters, [attackTypeMismatch(3)]);

    expect(result.content.disagreementRate).toBeCloseTo(0.25);
    expect(result.content.value).toBeLessThan(1);
    // The overall is a blend of a perfect structure (identity) and the
    // penalized content, so it sits strictly between them.
    expect(result.overall).toBeLessThan(result.structural.value);
    expect(result.overall).toBeGreaterThan(result.content.value);
  });

  it('reports the lowest score across multiple segments', () => {
    // Two segments with discriminability 1/3 and 1/6, and no bonus support.
    const entries: Alignment = [
      { action: MERGE, baseIndex: 0, targetIndex: 0, score: 5 },
      { action: MERGE, baseIndex: 1, targetIndex: 1, score: 3 },
      { action: MERGE, baseIndex: 2, targetIndex: 2, score: 3 },
      { action: MERGE, baseIndex: 3, targetIndex: 4, score: 5 },
      { action: MERGE, baseIndex: 4, targetIndex: 5, score: 3 },
      { action: MERGE, baseIndex: 5, targetIndex: 6, score: 3 },
      { action: MERGE, baseIndex: 6, targetIndex: 9, score: 5 },
    ];
    const la = makeLocalAlignment(
      entries,
      { baseStart: 0, baseEnd: 7, targetStart: 0, targetEnd: 10 },
      [
        [0, 0],
        [1, 1],
        [1, 2],
        [1, 3],
        [2, 1],
        [2, 2],
        [2, 3],
        [3, 4],
        [4, 5],
        [4, 6],
        [4, 7],
        [4, 8],
        [5, 5],
        [5, 6],
        [5, 7],
        [5, 8],
        [6, 9],
      ],
    );
    const alignment: AlignmentResult = {
      alignments: [la],
      baseCoverage: 1,
      targetCoverage: 1,
      gapCount: 0,
    };

    const { segments, worstSegmentIdx } = scoreStepConfidence(
      alignment,
      NO_COUNTERS,
      [],
    ).structural;

    expect(segments).toHaveLength(2);
    expect(segments[0].score).toBeCloseTo(1 / 3);
    expect(segments[1].score).toBeCloseTo(1 / 6);
    expect(worstSegmentIdx).toBe(1);
  });

  it('weights the structural axis against content by the axis weight', () => {
    // Perfect structure, but one mismatch.
    const counters: ReconciliationCounters = {
      ...NO_COUNTERS,
      playerAttacks: 2,
    };
    const flags = [attackTypeMismatch(1)];
    const structuralHeavy = scoreStepConfidence(null, counters, flags, {
      ...DEFAULT_CONFIDENCE_WEIGHTS,
      axis: 0.9,
    });
    const contentHeavy = scoreStepConfidence(null, counters, flags, {
      ...DEFAULT_CONFIDENCE_WEIGHTS,
      axis: 0.1,
    });
    expect(structuralHeavy.overall).toBeGreaterThan(contentHeavy.overall);
  });
});
