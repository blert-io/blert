import { AlignmentAction, AlignmentResult } from './alignment';

/**
 * Maps tick indices between a client's local tick space and the merged
 * timeline's tick space.
 */
export class TickMapping {
  private readonly forward: (number | undefined)[];
  private readonly reverse: (number | undefined)[];

  private constructor(
    forward: (number | undefined)[],
    reverse: (number | undefined)[],
  ) {
    this.forward = forward;
    this.reverse = reverse;
  }

  /**
   * Creates an identity mapping where tick N maps to merged tick N.
   * @param tickCount The number of client ticks in the mapping.
   */
  public static identity(tickCount: number): TickMapping {
    const mapping = Array.from({ length: tickCount }, (_, i) => i);
    return new TickMapping([...mapping], [...mapping]);
  }

  /**
   * Builds base and target tick mappings from an alignment result.
   *
   * Walks through the alignment entries in order, copying base ticks outside
   * alignments at their natural positions. Within each local alignment:
   * - MERGE maps both base and target to the same merged position
   * - KEEP maps only the base tick
   * - INSERT maps only the target tick, increasing the merged tick count
   *
   * @param baseTickCount The number of base ticks in the alignment.
   * @param targetTickCount The number of target ticks in the alignment.
   * @param alignment The alignment result to build mappings from.
   * @returns The base and target mappings, and the combined tick count.
   */
  public static fromAlignment(
    baseTickCount: number,
    targetTickCount: number,
    alignment: AlignmentResult,
  ): { base: TickMapping; target: TickMapping; mergedTickCount: number } {
    const baseToMerged = Array<number | undefined>(baseTickCount).fill(
      undefined,
    );
    const targetToMerged = Array<number | undefined>(targetTickCount).fill(
      undefined,
    );

    let mergedPos = 0;
    let basePos = 0;

    for (const localAlignment of alignment.alignments) {
      // Alignments always start and end with a MERGE entry.
      const firstBase = (localAlignment[0] as { baseIndex: number }).baseIndex;
      const lastEntry = localAlignment[localAlignment.length - 1];
      const lastBase = (lastEntry as { baseIndex: number }).baseIndex;

      while (basePos < firstBase) {
        baseToMerged[basePos] = mergedPos;
        mergedPos++;
        basePos++;
      }

      for (const entry of localAlignment) {
        switch (entry.action) {
          case AlignmentAction.MERGE:
            baseToMerged[entry.baseIndex] = mergedPos;
            targetToMerged[entry.targetIndex] = mergedPos;
            break;
          case AlignmentAction.KEEP:
            baseToMerged[entry.baseIndex] = mergedPos;
            break;
          case AlignmentAction.INSERT:
            targetToMerged[entry.targetIndex] = mergedPos;
            break;
        }
        mergedPos++;
      }

      basePos = lastBase + 1;
    }

    while (basePos < baseTickCount) {
      baseToMerged[basePos] = mergedPos;
      mergedPos++;
      basePos++;
    }

    const mergedTickCount = mergedPos;

    const mergedToBase = Array<number | undefined>(mergedTickCount).fill(
      undefined,
    );
    const mergedToTarget = Array<number | undefined>(mergedTickCount).fill(
      undefined,
    );

    for (let i = 0; i < baseTickCount; i++) {
      if (baseToMerged[i] !== undefined) {
        mergedToBase[baseToMerged[i]!] = i;
      }
    }
    for (let i = 0; i < targetTickCount; i++) {
      if (targetToMerged[i] !== undefined) {
        mergedToTarget[targetToMerged[i]!] = i;
      }
    }

    return {
      base: new TickMapping(baseToMerged, mergedToBase),
      target: new TickMapping(targetToMerged, mergedToTarget),
      mergedTickCount,
    };
  }

  /** The number of client ticks in this mapping. */
  public get clientTickCount(): number {
    return this.forward.length;
  }

  /** Maps a client tick index to its merged tick index. */
  public toMerged(clientTick: number): number | undefined {
    return this.forward[clientTick];
  }

  /** Maps a merged tick index to its client tick index. */
  public toClient(mergedTick: number): number | undefined {
    return this.reverse[mergedTick];
  }
}

type MappingChainEntry = {
  targetClientId: number;
  baseMapping: TickMapping;
  targetMapping: TickMapping;
  mergedTickCount: number;
};

/**
 * Tracks the composed tick mapping state across an entire merge operation.
 *
 * Each successful merge step appends an entry recording its base and target
 * mappings. To resolve a tick from the current merged space back to any
 * client's original tick space, the chain is walked in reverse.
 *
 * The in-flight entry represents the current (uncommitted) merge step. It
 * participates in resolution but is not part of the committed chain. If
 * the step fails, clear it; if it succeeds, call {@link commit}.
 */
export class MergeMapping {
  private readonly baseClientId: number;
  private readonly chain: MappingChainEntry[] = [];
  private inFlight: MappingChainEntry | null = null;

  constructor(baseClientId: number) {
    this.baseClientId = baseClientId;
  }

  /**
   * Sets the in-flight entry for the current merge step.
   *
   * @param targetClientId The ID of the target client.
   * @param baseMapping The tick mapping for base timeline.
   * @param targetMapping The tick mapping for target client's timeline.
   * @param mergedTickCount The merged tick count for the merge step.
   */
  public begin(
    targetClientId: number,
    baseMapping: TickMapping,
    targetMapping: TickMapping,
    mergedTickCount: number,
  ): void {
    this.inFlight = {
      targetClientId,
      baseMapping,
      targetMapping,
      mergedTickCount,
    };
  }

  /** Commits the in-flight entry to the chain. */
  public commit(): void {
    if (this.inFlight !== null) {
      this.chain.push(this.inFlight);
      this.inFlight = null;
    }
  }

  /** Discards the in-flight entry. */
  public discard(): void {
    this.inFlight = null;
  }

  /**
   * Returns the base mapping for the current in-flight merge step, or
   * `null` if no step is in progress.
   */
  public getBaseMapping(): TickMapping | null {
    return this.inFlight?.baseMapping ?? null;
  }

  /**
   * Returns the target mapping for the current in-flight merge step, or
   * `null` if no step is in progress.
   */
  public getTargetMapping(): TickMapping | null {
    return this.inFlight?.targetMapping ?? null;
  }

  /**
   * Returns the merged tick count for the current in-flight merge step, or
   * `null` if no step is in progress.
   */
  public getMergedTickCount(): number | null {
    return this.inFlight?.mergedTickCount ?? null;
  }

  /**
   * Resolves a tick index in the current merged space back to a specific
   * client's original tick space.
   *
   * @param mergedIndex The index of the tick in the merged space.
   * @param clientId ID of the client for which to resolve the tick.
   * @returns Index of the tick in the client's original tick space,
   *   or `undefined` if the tick is not mapped.
   */
  public resolveClientTick(
    mergedIndex: number,
    clientId: number,
  ): number | undefined {
    let current: number | undefined = mergedIndex;

    if (this.inFlight !== null) {
      if (this.inFlight.targetClientId === clientId) {
        return this.inFlight.targetMapping.toClient(current);
      }
      current = this.inFlight.baseMapping.toClient(current);
      if (current === undefined) {
        return undefined;
      }
    }

    for (let i = this.chain.length - 1; i >= 0; i--) {
      const entry = this.chain[i];

      if (entry.targetClientId === clientId) {
        return entry.targetMapping.toClient(current);
      }

      current = entry.baseMapping.toClient(current);
      if (current === undefined) {
        return undefined;
      }
    }

    if (clientId === this.baseClientId) {
      return current;
    }

    return undefined;
  }
}
