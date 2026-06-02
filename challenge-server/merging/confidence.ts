import {
  Alignment,
  AlignmentAction,
  AlignmentRange,
  AlignmentResult,
  LocalAlignment,
  MergeEntry,
} from './alignment';
import { ReconciliationCounters } from './event-consolidator';
import { clamp, noisyOr, safeDiv, softMin } from './math';
import { QualityFlag } from './quality';

export type SegmentConfidence = {
  /** Start of the segment region. */
  baseStart: number;
  /** Exclusive end of the segment region. */
  baseEnd: number;
  /**
   * Reciprocal of the number of potential compatible paths the segment's
   * alignment could have taken.
   */
  discriminability: number;
  /** Decisiveness of the chosen alignment relative to the best alternative. */
  bonusSupport: number;
  /** Overall score combining discriminability and bonus support. */
  score: number;
};

export type StructuralConfidence = {
  /** Axis value in [0, 1]. */
  value: number;
  /** True if the step was identity mapped, resulting in a value of 1. */
  identity: boolean;
  /** Fraction of target ticks placed across all local alignments. */
  targetCoverage: number;
  /** Score breakdown of every ambiguous segment within the alignment. */
  segments: SegmentConfidence[];
  /** Index of the lowest scoring segment. */
  worstSegmentIdx: number | null;
};

export type ContentConfidence = {
  /** Axis value in [0, 1]. */
  value: number;
  /**
   * Fraction of player and NPC attacks/spells that conflicted between clients.
   */
  disagreementRate: number;
  /**
   * Fraction of paired stream events that had an abnormally large gap between
   * the base and target ticks.
   */
  largeGapRate: number;
  /** Fraction of attack-mapped events that failed to map to an attack. */
  attackMappedFailureRate: number;
};

export type StepConfidence = {
  /** Combined score in [0, 1]. */
  overall: number;
  structural: StructuralConfidence;
  content: ContentConfidence;
};

export type ConfidenceWeights = {
  /** Weight of the structural axis in the overall score. */
  axis: number;
  structural: {
    /**
     * Margin scale for bonus support. A per-step margin of this size maps to
     * roughly 63% support via `1 - exp(-margin / supportScale)`. On the order
     * of the alignment's gap penalty, since geometry alone yields margins of
     * about that size.
     */
    supportScale: number;
    /**
     * Soft-min temperature for combining per-step support across a segment.
     * Lower values approach a hard minimum where one weak step dominates.
     */
    supportTemperature: number;
  };
  content: {
    disagreement: number;
    largeGap: number;
    attackMappedFailure: number;
  };
};

export const DEFAULT_CONFIDENCE_WEIGHTS: ConfidenceWeights = {
  axis: 0.5,
  structural: {
    supportScale: 5,
    supportTemperature: 0.1,
  },
  content: {
    disagreement: 0.6,
    largeGap: 0.2,
    attackMappedFailure: 0.2,
  },
};

export type Anchor = {
  kind: 'anchor';
  baseIndex: number;
  targetIndex: number;
};

/**
 * A segment represents an ambiguous compatible run of actions within a local
 * alignment. In simple terms, it is a region of the alignment where tick
 * compatibility alone did not force a path, and similarity scoring had to
 * come into play to choose between alternatives.
 */
export type Segment = {
  kind: 'segment';
  /** The ambiguous merges and interleaved gaps, trimmed to first/last merge. */
  entries: Alignment;
  /** The tick range bounding the segment. */
  region: AlignmentRange;
};

export type AlignmentPartition = Anchor | Segment;

/**
 * Counts the monotone matchings of exactly length `size` among `cells`, where a
 * matching is a subsequence strictly increasing in both row and column, i.e.
 * the number of distinct order-preserving ways `size` pairs could be drawn.
 */
export function countMonotoneMatchings(
  cells: readonly (readonly [number, number])[],
  size: number,
): number {
  if (size <= 0) {
    return size === 0 ? 1 : 0;
  }

  // Sort by (row, col) so every valid predecessor of a cell appears before it.
  const sorted = cells.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = sorted.length;

  // The width of each "row" in the DP table.
  const stride = size + 1;

  // `dp[i][s]` = number of size `s` matchings ending at `sorted[i]`.
  const dp = new Float64Array(n * stride);

  let total = 0;
  for (let i = 0; i < n; i++) {
    const offsetI = i * stride;
    dp[offsetI + 1] = 1; // dp[i][1] = 1

    const rowI = sorted[i][0];
    const colI = sorted[i][1];

    for (let j = 0; j < i; j++) {
      if (sorted[j][0] < rowI && sorted[j][1] < colI) {
        const offsetJ = j * stride;

        for (let s = 2; s <= size; s++) {
          dp[offsetI + s] += dp[offsetJ + s - 1];
        }
      }
    }
    total += dp[offsetI + size];
  }
  return total;
}

/**
 * Region size (non-null base ticks x target ticks) above which the exact path
 * count is replaced by a closed-form estimate.
 * The exact DP is `O(cells^2 * mergeCount)`, so this avoids degenerate cases
 * like a large region where every tick is compatible wasting time computing a
 * value that's effectively 0 or 1.
 */
const MAX_EXACT_REGION = 1024;

const MAX_PATH_COUNT = 1e9;

/** `C(n, k)`, clamped at `MAX_PATH_COUNT`. */
function boundedBinomial(n: number, k: number): number {
  if (k < 0 || k > n) {
    return 0;
  }
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < kk; i++) {
    result = (result * (n - i)) / (i + 1);
    if (result > MAX_PATH_COUNT) {
      return MAX_PATH_COUNT;
    }
  }
  return result;
}

function isNullMerge(la: LocalAlignment, entry: MergeEntry): boolean {
  return (
    la.baseNull.has(entry.baseIndex) || la.targetNull.has(entry.targetIndex)
  );
}

/**
 * Lower and upper bounds of the contiguous run of compatible cells in row
 * `iRel` around column `jRel`, i.e. how far the merge could drift in the
 * target direction before compatibility breaks.
 */
function plateauBounds(
  la: LocalAlignment,
  iRel: number,
  jRel: number,
): [number, number] {
  const row = la.similarity[iRel];
  const { targetStart } = la.range;
  // Null target columns are "compatible" only because a null scores 0; they are
  // not real alternatives, so they don't widen the plateau.
  const compatible = (col: number) =>
    Number.isFinite(row[col]) && !la.targetNull.has(targetStart + col);
  let lo = jRel;
  let hi = jRel;
  while (lo > 0 && compatible(lo - 1)) {
    lo--;
  }
  while (hi < row.length - 1 && compatible(hi + 1)) {
    hi++;
  }
  return [lo, hi];
}

/**
 * Partitions a local alignment into anchors and segments.
 *
 * An anchor is a MERGE whose base tick is compatible with exactly one adjacent
 * target tick (plateau 1): the fingerprint pinned the match. A segment is a run
 * of ambiguous merges (plateau > 1) together with any gaps interleaved between
 * them.
 *
 * Gaps that are not interleaved between ambiguous merges (between two anchors,
 * or leading/trailing a segment) are pinned by their surrounding anchors and
 * carry no structural uncertainty, so they are not emitted.
 */
export function partitionAlignment(la: LocalAlignment): AlignmentPartition[] {
  const plateaus = new Map<number, number>();
  for (let idx = 0; idx < la.entries.length; idx++) {
    const entry = la.entries[idx];
    if (entry.action === AlignmentAction.MERGE && !isNullMerge(la, entry)) {
      // A null merge is left unclassified so it falls through as a gap.
      const iRel = entry.baseIndex - la.range.baseStart;
      const jRel = entry.targetIndex - la.range.targetStart;
      const [lo, hi] = plateauBounds(la, iRel, jRel);
      plateaus.set(idx, hi - lo + 1);
    }
  }

  const isAnchor = (idx: number) => plateaus.get(idx) === 1;
  const isAmbiguousMerge = (idx: number) => (plateaus.get(idx) ?? 0) > 1;

  const partitions: AlignmentPartition[] = [];

  // Entry indices accumulated since the last anchor, pending classification.
  let pending: number[] = [];

  const flushPending = (
    leftAnchor: MergeEntry | null,
    rightAnchor: MergeEntry | null,
  ) => {
    // The pending run forms a segment only if it contains an ambiguous merge.
    // Trim to the span between the first and last ambiguous merge; gaps outside
    // that span are pinned by the surrounding anchors.
    let first = -1;
    let last = -1;
    for (const idx of pending) {
      if (isAmbiguousMerge(idx)) {
        if (first === -1) {
          first = idx;
        }
        last = idx;
      }
    }
    if (first !== -1) {
      const firstMerge = la.entries[first] as MergeEntry;
      const lastMerge = la.entries[last] as MergeEntry;
      // An unpinned (edge) side is bounded by the segment's own merges rather
      // than the search range. Base uses its matched extent, target uses the
      // union of its plateaus.
      let tLo = Infinity;
      let tHi = -Infinity;
      for (let k = first; k <= last; k++) {
        const e = la.entries[k];
        if (e.action !== AlignmentAction.MERGE || isNullMerge(la, e)) {
          continue;
        }
        const [lo, hi] = plateauBounds(
          la,
          e.baseIndex - la.range.baseStart,
          e.targetIndex - la.range.targetStart,
        );
        tLo = Math.min(tLo, lo);
        tHi = Math.max(tHi, hi);
      }
      const region: AlignmentRange = {
        baseStart: leftAnchor ? leftAnchor.baseIndex + 1 : firstMerge.baseIndex,
        baseEnd: rightAnchor ? rightAnchor.baseIndex : lastMerge.baseIndex + 1,
        targetStart: leftAnchor
          ? leftAnchor.targetIndex + 1
          : la.range.targetStart + tLo,
        targetEnd: rightAnchor
          ? rightAnchor.targetIndex
          : la.range.targetStart + tHi + 1,
      };
      partitions.push({
        kind: 'segment',
        entries: la.entries.slice(first, last + 1),
        region,
      });
    }
    pending = [];
  };

  let prevAnchor: MergeEntry | null = null;
  for (let idx = 0; idx < la.entries.length; idx++) {
    if (isAnchor(idx)) {
      const anchor = la.entries[idx] as MergeEntry;
      flushPending(prevAnchor, anchor);
      partitions.push({
        kind: 'anchor',
        baseIndex: anchor.baseIndex,
        targetIndex: anchor.targetIndex,
      });
      prevAnchor = anchor;
    } else {
      pending.push(idx);
    }
  }

  flushPending(prevAnchor, null);
  return partitions;
}

/**
 * Computes the "geometric freedom" of a segment within an alignment: the
 * reciprocal of the number of distinct monotone paths its merges could
 * have taken through its compatible cells.
 *
 * Null cells are excluded from the region.
 *
 * If no paths exist, returns a discriminability of 1.
 */
export function segmentDiscriminability(
  la: LocalAlignment,
  segment: Segment,
): number {
  const mergeCount = segment.entries
    .values()
    .filter((e) => e.action === AlignmentAction.MERGE && !isNullMerge(la, e))
    .reduce((acc, _) => acc + 1, 0);

  let nonNullBase = 0;
  for (let b = segment.region.baseStart; b < segment.region.baseEnd; b++) {
    if (!la.baseNull.has(b)) {
      nonNullBase++;
    }
  }
  let nonNullTarget = 0;
  for (let t = segment.region.targetStart; t < segment.region.targetEnd; t++) {
    if (!la.targetNull.has(t)) {
      nonNullTarget++;
    }
  }

  // If the region is too large, skip the DP and use a closed-form estimate.
  if (nonNullBase * nonNullTarget > MAX_EXACT_REGION) {
    const paths =
      boundedBinomial(nonNullBase, mergeCount) *
      boundedBinomial(nonNullTarget, mergeCount);
    return paths <= 1 ? 1 : 1 / paths;
  }

  const cells: [number, number][] = [];
  for (let b = segment.region.baseStart; b < segment.region.baseEnd; b++) {
    if (la.baseNull.has(b)) {
      continue;
    }
    const row = la.similarity[b - la.range.baseStart];
    for (
      let t = segment.region.targetStart;
      t < segment.region.targetEnd;
      t++
    ) {
      if (la.targetNull.has(t)) {
        continue;
      }
      if (Number.isFinite(row[t - la.range.targetStart])) {
        cells.push([b, t]);
      }
    }
  }

  const paths = countMonotoneMatchings(cells, mergeCount);
  return paths <= 1 ? 1 : 1 / paths;
}

/**
 * Computes the `bonusSupport` value for a segment, which measures how strongly
 * each chosen alignment action was preferred.
 *
 * Scales each alignment action's precomputed margin by
 * `1 - exp(-margin / supportScale)` to get a support value.
 * The segment's bonus support is a softmin over those values.
 */
export function segmentBonusSupport(
  la: LocalAlignment,
  segment: Segment,
  supportScale: number,
  temperature: number,
): number {
  const { baseStart, targetStart } = la.range;

  const supports: number[] = [];

  // Map each action back to its base/target cells.
  // Segments always begin with a MERGE so the initial indices are always valid.
  let curBase = 0;
  let curTarget = 0;
  for (const entry of segment.entries) {
    let nullMerge = false;
    if (entry.action === AlignmentAction.MERGE) {
      curBase = entry.baseIndex;
      curTarget = entry.targetIndex;
      nullMerge = isNullMerge(la, entry);
    } else if (entry.action === AlignmentAction.KEEP) {
      curBase = entry.baseIndex;
    } else {
      curTarget = entry.targetIndex;
    }

    // A null merge occupies a cell but isn't real evidence; skip it.
    if (nullMerge) {
      continue;
    }
    const margin = la.margin[curBase - baseStart][curTarget - targetStart];
    supports.push(1 - Math.exp(-margin / supportScale));
  }

  return softMin(supports, temperature);
}

const MISMATCH_FLAG_KINDS: ReadonlySet<QualityFlag['kind']> = new Set([
  'ATTACK_TYPE_MISMATCH',
  'ATTACK_TARGET_MISMATCH',
  'SPELL_TYPE_MISMATCH',
  'SPELL_TARGET_MISMATCH',
  'NPC_ATTACK_TYPE_MISMATCH',
  'NPC_ATTACK_TARGET_MISMATCH',
]);

function computeContentConfidence(
  counters: ReconciliationCounters,
  qualityFlags: QualityFlag[],
  weights: ConfidenceWeights['content'],
): ContentConfidence {
  let mismatches = 0;
  let largeGaps = 0;
  let attackMappedFailures = 0;

  for (const flag of qualityFlags) {
    if (MISMATCH_FLAG_KINDS.has(flag.kind)) {
      mismatches++;
    } else if (flag.kind === 'LARGE_TEMPORAL_GAP') {
      largeGaps++;
    } else if (
      flag.kind === 'UNEXPECTED_CONFLICT' ||
      flag.kind === 'ATTACK_MAPPED_NOT_FOUND'
    ) {
      attackMappedFailures++;
    }
  }

  const attempts =
    counters.playerAttacks + counters.playerSpells + counters.npcAttacks;
  const disagreementRate = safeDiv(mismatches, attempts);
  const largeGapRate = safeDiv(largeGaps, counters.streamEventPairs);
  const attackMappedFailureRate = safeDiv(
    attackMappedFailures,
    counters.attackMappedEvents,
  );

  const penalty = clamp(
    weights.disagreement * disagreementRate +
      weights.largeGap * largeGapRate +
      weights.attackMappedFailure * attackMappedFailureRate,
    0,
    1,
  );

  return {
    value: 1 - penalty,
    disagreementRate,
    largeGapRate,
    attackMappedFailureRate,
  };
}

function computeStructuralConfidence(
  alignment: AlignmentResult | null,
  weights: ConfidenceWeights['structural'],
): StructuralConfidence {
  if (alignment === null) {
    return {
      value: 1,
      identity: true,
      targetCoverage: 1,
      segments: [],
      worstSegmentIdx: null,
    };
  }

  const segments: SegmentConfidence[] = [];
  let weightedQualitySum = 0;
  let totalMergeCount = 0;

  for (const la of alignment.alignments) {
    let qualityNum = 0;
    let qualityDen = 0;
    for (const part of partitionAlignment(la)) {
      if (part.kind === 'anchor') {
        qualityNum += 1;
        qualityDen += 1;
        continue;
      }

      const discriminability = segmentDiscriminability(la, part);
      const bonusSupport = segmentBonusSupport(
        la,
        part,
        weights.supportScale,
        weights.supportTemperature,
      );
      const score = noisyOr(discriminability, bonusSupport);

      const baseSpan = part.region.baseEnd - part.region.baseStart;
      qualityNum += score * baseSpan;
      qualityDen += baseSpan;

      segments.push({
        baseStart: part.region.baseStart,
        baseEnd: part.region.baseEnd,
        discriminability,
        bonusSupport,
        score,
      });
    }

    if (qualityDen === 0) {
      continue;
    }

    let mergeCount = 0;
    for (const entry of la.entries) {
      if (entry.action === AlignmentAction.MERGE) {
        mergeCount++;
      }
    }

    // Larger alignments contribute more to the cross-alignment mean.
    const quality = qualityNum / qualityDen;
    weightedQualitySum += quality * mergeCount;
    totalMergeCount += mergeCount;
  }

  const weightedQuality = safeDiv(weightedQualitySum, totalMergeCount);
  const value = weightedQuality * alignment.targetCoverage;

  let worstSegmentIdx: number | null = null;
  for (let i = 0; i < segments.length; i++) {
    if (
      worstSegmentIdx === null ||
      segments[i].score < segments[worstSegmentIdx].score
    ) {
      worstSegmentIdx = i;
    }
  }

  return {
    value,
    identity: false,
    targetCoverage: alignment.targetCoverage,
    segments,
    worstSegmentIdx,
  };
}

export function scoreStepConfidence(
  alignment: AlignmentResult | null,
  counters: ReconciliationCounters,
  qualityFlags: QualityFlag[],
  weights: ConfidenceWeights = DEFAULT_CONFIDENCE_WEIGHTS,
): StepConfidence {
  const content = computeContentConfidence(
    counters,
    qualityFlags,
    weights.content,
  );
  const structural = computeStructuralConfidence(alignment, weights.structural);

  const overall =
    weights.axis * structural.value + (1 - weights.axis) * content.value;

  return { overall, structural, content };
}
