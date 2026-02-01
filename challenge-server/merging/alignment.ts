import { TickState, TickStateArray } from './tick-state';

export const enum AlignmentAction {
  /** Base and target ticks are aligned; merge target data into base. */
  MERGE = 'MERGE',
  /** Target-only tick (gap in base). */
  INSERT = 'INSERT',
  /** Base-only tick (gap in target). */
  KEEP = 'KEEP',
}

type MergeEntry = {
  action: AlignmentAction.MERGE;
  baseIndex: number;
  targetIndex: number;
  score: number;
};

type InsertEntry = {
  action: AlignmentAction.INSERT;
  targetIndex: number;
};

type KeepEntry = {
  action: AlignmentAction.KEEP;
  baseIndex: number;
};

export type AlignmentEntry = MergeEntry | InsertEntry | KeepEntry;

/** An ordered sequence of alignment actions from a single local alignment. */
export type LocalAlignment = AlignmentEntry[];

export type AlignmentResult = {
  /** Ordered local alignments extracted from the scoring matrix. */
  alignments: LocalAlignment[];
  /** Fraction of base ticks covered by MERGE actions (0-1). */
  coverage: number;
  /** Total number of gap actions (INSERT + KEEP) across all alignments. */
  gapCount: number;
};

type AlignmentRange = {
  baseStart: number;
  baseEnd: number;
  targetStart: number;
  targetEnd: number;
};

const enum Direction {
  /** Score was 0; alignment restarts here. */
  NONE = 0,
  /** Came from diagonal; base[i] aligned with target[j]. */
  MATCH = 1,
  /** Came from above; gap in target. */
  GAP_TARGET = 2,
  /** Came from left; gap in base. */
  GAP_BASE = 3,
}

type AlignmentMatrices = {
  matrix: number[][];
  direction: Direction[][];
  similarity: number[][];
};

export type SimilarityFn = (base: TickState, target: TickState) => number;

export type AlignmentConfig = {
  /** The minimum score required for an alignment to be considered valid. */
  minScore: number;
  /** The minimum length required for an alignment to be considered valid. */
  minLength: number;
  /**
   * The minimum number of ticks required in each timeline before attempting to
   * align them.
   *
   * This should be set to a value larger than `minLength` to provide additional
   * context from surrounding ticks and allow for identifying gaps.
   */
  minContext: number;

  /** The penalty for opening a gap. */
  gapOpenPenalty: number;
};

const DEFAULT_ALIGNMENT_CONFIG: AlignmentConfig = {
  minScore: 5,
  minLength: 3,
  minContext: 10,
  gapOpenPenalty: 5,
};

export class TickAligner {
  private readonly config: AlignmentConfig;
  private readonly base: TickStateArray;
  private readonly target: TickStateArray;
  private readonly scoreFn: SimilarityFn;

  private alignments: LocalAlignment[] = [];

  public constructor(
    base: TickStateArray,
    target: TickStateArray,
    scoreFn: SimilarityFn,
    config: Partial<AlignmentConfig> = {},
  ) {
    this.config = { ...DEFAULT_ALIGNMENT_CONFIG, ...config };
    this.base = base;
    this.target = target;
    this.scoreFn = scoreFn;
    this.alignments = [];
  }

  public align(): AlignmentResult {
    this.alignments = [];

    this.alignOver({
      baseStart: 0,
      baseEnd: this.base.length,
      targetStart: 0,
      targetEnd: this.target.length,
    });

    let mergeCount = 0;
    let gapCount = 0;
    for (const alignment of this.alignments) {
      for (const entry of alignment) {
        if (entry.action === AlignmentAction.MERGE) {
          mergeCount++;
        } else {
          gapCount++;
        }
      }
    }

    return {
      alignments: this.alignments,
      coverage: this.base.length > 0 ? mergeCount / this.base.length : 0,
      gapCount,
    };
  }

  private alignOver(range: AlignmentRange): boolean {
    if (
      range.baseEnd - range.baseStart < this.config.minContext ||
      range.targetEnd - range.targetStart < this.config.minContext
    ) {
      return false;
    }

    const localAlignment = this.alignLocal(range);
    if (localAlignment === null) {
      return false;
    }

    const first = localAlignment[0] as MergeEntry;
    const last = localAlignment[localAlignment.length - 1] as MergeEntry;

    this.alignOver({
      baseStart: range.baseStart,
      baseEnd: first.baseIndex,
      targetStart: range.targetStart,
      targetEnd: first.targetIndex,
    });

    this.alignments.push(localAlignment);

    this.alignOver({
      baseStart: last.baseIndex + 1,
      baseEnd: range.baseEnd,
      targetStart: last.targetIndex + 1,
      targetEnd: range.targetEnd,
    });

    return true;
  }

  private alignLocal(range: AlignmentRange): LocalAlignment | null {
    const matrices = this.fillMatrices(range);
    const entries = this.backtrackBest(range, matrices);
    if (entries === null || entries.length < this.config.minLength) {
      return null;
    }
    return entries;
  }

  /**
   * Finds the highest-scoring cell in the matrix, backtracks to extract the
   * alignment, and zeroes out visited cells so subsequent calls find the next
   * best alignment.
   */
  private backtrackBest(
    range: AlignmentRange,
    matrices: AlignmentMatrices,
  ): AlignmentEntry[] | null {
    // Find the global maximum.
    let maxScore = 0;
    let maxI = 0;
    let maxJ = 0;

    for (let i = 0; i < matrices.matrix.length; i++) {
      for (let j = 0; j < matrices.matrix[i].length; j++) {
        if (matrices.matrix[i][j] > maxScore) {
          maxScore = matrices.matrix[i][j];
          maxI = i;
          maxJ = j;
        }
      }
    }

    if (maxScore < this.config.minScore) {
      return null;
    }

    // Trace back from the maximum, collecting all actions.
    const entries: AlignmentEntry[] = [];
    let i = maxI;
    let j = maxJ;

    while (i >= 0 && j >= 0 && matrices.direction[i][j] !== Direction.NONE) {
      const dir = matrices.direction[i][j];

      switch (dir) {
        case Direction.MATCH:
          entries.push({
            action: AlignmentAction.MERGE,
            baseIndex: i + range.baseStart,
            targetIndex: j + range.targetStart,
            score: matrices.similarity[i][j],
          });
          i--;
          j--;
          break;
        case Direction.GAP_TARGET:
          entries.push({
            action: AlignmentAction.KEEP,
            baseIndex: i + range.baseStart,
          });
          i--;
          break;
        case Direction.GAP_BASE:
          entries.push({
            action: AlignmentAction.INSERT,
            targetIndex: j + range.targetStart,
          });
          j--;
          break;
      }
    }

    entries.reverse();
    return entries;
  }

  private fillMatrices(range: AlignmentRange): AlignmentMatrices {
    const matrix: number[][] = [];
    const direction: Direction[][] = [];
    const similarity: number[][] = [];

    for (let i = range.baseStart; i < range.baseEnd; i++) {
      matrix.push(Array<number>(range.targetEnd - range.targetStart).fill(0));
      direction.push(
        Array<Direction>(range.targetEnd - range.targetStart).fill(
          Direction.NONE,
        ),
      );
      similarity.push(
        Array<number>(range.targetEnd - range.targetStart).fill(0),
      );
    }

    const set = <T>(m: T[][], i: number, j: number, value: T) =>
      (m[i - range.baseStart][j - range.targetStart] = value);
    const h = (i: number, j: number) =>
      matrix[i - range.baseStart]?.[j - range.targetStart] ?? 0;

    for (let i = range.baseStart; i < range.baseEnd; i++) {
      for (let j = range.targetStart; j < range.targetEnd; j++) {
        const similarityScore = this.scoreSimilarity(i, j);
        set(similarity, i, j, similarityScore);
        const gapPenalty = this.config.gapOpenPenalty; // TODO(frolv): affine

        const scores = [
          0,
          h(i - 1, j - 1) + similarityScore,
          h(i - 1, j) - gapPenalty,
          h(i, j - 1) - gapPenalty,
        ];

        const maxScore = Math.max(...scores);
        set(matrix, i, j, maxScore);

        // Record direction based on which path gave the max score.
        if (maxScore === scores[1] && Number.isFinite(similarityScore)) {
          set(direction, i, j, Direction.MATCH);
        } else if (maxScore === scores[2]) {
          set(direction, i, j, Direction.GAP_TARGET);
        } else if (maxScore === scores[3]) {
          set(direction, i, j, Direction.GAP_BASE);
        } else {
          set(direction, i, j, Direction.NONE);
        }
      }
    }

    return { matrix, direction, similarity };
  }

  private scoreSimilarity(i: number, j: number): number {
    if (this.base[i] === null || this.target[j] === null) {
      return 0;
    }
    return this.scoreFn(this.base[i], this.target[j]);
  }
}
