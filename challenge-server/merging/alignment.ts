import { TickState, TickStateArray } from './tick-state';

export type AlignmentResult = {
  /** Maps target array index → base array index for aligned ticks. */
  mapping: Map<number, number>;
  /** Per-tick similarity score for each aligned pair, keyed by target index. */
  scores: Map<number, number>;
  /** Fraction of base ticks that were aligned (0-1). */
  coverage: number;
  /** Number of gap insertions in the alignment. */
  gapCount: number;
};

const MIN_ALIGNMENT_SCORE = 5;
const MIN_ALIGNMENT_LENGTH = 3;

type AlignedPair = {
  baseIndex: number;
  targetIndex: number;
  score: number;
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

export type SimilarityFn = (base: TickState, target: TickState) => number;

export class TickAligner {
  private readonly base: TickStateArray;
  private readonly target: TickStateArray;
  private readonly scoreFn: SimilarityFn;

  private matrix: number[][];
  private direction: Direction[][];
  private similarity: number[][];

  public constructor(
    base: TickStateArray,
    target: TickStateArray,
    scoreFn: SimilarityFn,
  ) {
    this.base = base;
    this.target = target;
    this.scoreFn = scoreFn;
    this.matrix = [];
    this.direction = [];
    this.similarity = [];
  }

  public align(): AlignmentResult {
    this.fillMatrix();

    const allPairs: AlignedPair[] = [];
    let gapCount = 0;

    // Extract multiple local alignments by repeatedly finding the best
    // remaining alignment and zeroing out visited cells.
    while (true) {
      const { pairs, gaps } = this.backtrackBest();
      if (pairs.length < MIN_ALIGNMENT_LENGTH) {
        break;
      }
      allPairs.push(...pairs);
      gapCount += gaps;
    }

    // Sort by base index to ensure monotonic ordering.
    allPairs.sort((a, b) => a.baseIndex - b.baseIndex);

    const mapping = new Map<number, number>();
    const scores = new Map<number, number>();
    const coveredBaseIndices = new Set<number>();

    for (const pair of allPairs) {
      mapping.set(pair.targetIndex, pair.baseIndex);
      scores.set(pair.targetIndex, pair.score);
      coveredBaseIndices.add(pair.baseIndex);
    }

    const coverage =
      this.base.length > 0 ? coveredBaseIndices.size / this.base.length : 0;

    return { mapping, scores, coverage, gapCount };
  }

  /**
   * Finds the highest-scoring cell in the matrix, backtracks to extract the
   * alignment, and zeroes out visited cells so subsequent calls find the next
   * best alignment.
   */
  private backtrackBest(): { pairs: AlignedPair[]; gaps: number } {
    // Find the global maximum.
    let maxScore = 0;
    let maxI = 0;
    let maxJ = 0;

    for (let i = 0; i < this.base.length; i++) {
      for (let j = 0; j < this.target.length; j++) {
        if (this.matrix[i][j] > maxScore) {
          maxScore = this.matrix[i][j];
          maxI = i;
          maxJ = j;
        }
      }
    }

    if (maxScore < MIN_ALIGNMENT_SCORE) {
      return { pairs: [], gaps: 0 };
    }

    // Trace back from the maximum, collecting matched pairs.
    const pairs: AlignedPair[] = [];
    let gaps = 0;
    let i = maxI;
    let j = maxJ;

    while (i >= 0 && j >= 0 && this.direction[i][j] !== Direction.NONE) {
      const dir = this.direction[i][j];

      // Zero out the visited cell so it's not found again.
      this.matrix[i][j] = 0;
      this.direction[i][j] = Direction.NONE;

      switch (dir) {
        case Direction.MATCH:
          pairs.push({
            baseIndex: i,
            targetIndex: j,
            score: this.similarity[i][j],
          });
          i--;
          j--;
          break;
        case Direction.GAP_TARGET:
          gaps++;
          i--;
          break;
        case Direction.GAP_BASE:
          gaps++;
          j--;
          break;
      }
    }

    pairs.reverse();
    return { pairs, gaps };
  }

  private fillMatrix(): void {
    this.matrix = [];
    this.direction = [];
    this.similarity = [];

    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let i = 0; i < this.base.length; i++) {
      this.matrix.push(Array<number>(this.target.length).fill(0));
      this.direction.push(
        Array<Direction>(this.target.length).fill(Direction.NONE),
      );
      this.similarity.push(Array<number>(this.target.length).fill(0));
    }

    const h = (i: number, j: number) => this.matrix[i]?.[j] ?? 0;

    for (let i = 0; i < this.base.length; i++) {
      for (let j = 0; j < this.target.length; j++) {
        const similarityScore = this.scoreSimilarity(i, j);
        this.similarity[i][j] = similarityScore;
        const gapPenalty = 5; // TODO(frolv): affine

        const scores = [
          0,
          h(i - 1, j - 1) + similarityScore,
          h(i - 1, j) - gapPenalty,
          h(i, j - 1) - gapPenalty,
        ];

        const maxScore = Math.max(...scores);
        this.matrix[i][j] = maxScore;

        // Record direction based on which path gave the max score.
        if (maxScore === scores[1] && Number.isFinite(similarityScore)) {
          this.direction[i][j] = Direction.MATCH;
        } else if (maxScore === scores[2]) {
          this.direction[i][j] = Direction.GAP_TARGET;
        } else if (maxScore === scores[3]) {
          this.direction[i][j] = Direction.GAP_BASE;
        } else {
          this.direction[i][j] = Direction.NONE;
        }
      }
    }
  }

  private scoreSimilarity(i: number, j: number): number {
    if (this.base[i] === null || this.target[j] === null) {
      return 0;
    }
    return this.scoreFn(this.base[i], this.target[j]);
  }
}
