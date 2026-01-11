import type {
  BlertChartFormat,
  BCFAction,
  BCFActor,
  BCFTick,
  BCFCell,
  BCFCustomRow,
  BCFCustomRowCell,
  BCFCustomState,
  BCFSplit,
  BCFBackgroundColor,
  BCFColor,
  BCFColorIntensity,
  BCFNpcState,
} from './types';

/**
 * Resolved state for a player at a specific tick.
 */
export interface ResolvedPlayerState {
  /** Whether the player is dead. */
  isDead: boolean;
  /** Player's special attack energy (0-100). */
  specEnergy?: number;
  /** Whether the player is off cooldown. */
  offCooldown?: boolean;
  /** Custom state indicators. */
  customStates: BCFCustomState[];
}

/**
 * Resolved state for an NPC at a specific tick.
 */
export interface ResolvedNpcState {
  /** Text label to display. */
  label?: string;
  /** Custom state indicators. */
  customStates: BCFCustomState[];
}

export type ResolvedBackgroundColor = BCFBackgroundColor & {
  intensity: BCFColorIntensity;
  length: number;
};

export type ResolvedActorState = ResolvedPlayerState | ResolvedNpcState;

/**
 * Resolver for BCF documents.
 *
 * The document is assumed to be valid; use `validate()` before constructing
 * if validation is needed.
 *
 * @typeParam ActionType The action (strict or lax) type used in the document.
 *
 * @example
 * ```typescript
 * const result = validate(data);
 * if (!result.valid) {
 *   throw new Error('Invalid BCF');
 * }
 *
 * const resolver = new BCFResolver(result.document);
 *
 * // Get resolved state for 'player-1' at tick 10.
 * const state = resolver.getPlayerState('player-1', 10);
 *
 * // Get cell data for 'player-1' at tick 10.
 * const cell = resolver.getCell('player-1', 10);
 * ```
 */
export class BCFResolver<ActionType extends { type: string } = BCFAction> {
  private readonly doc: BlertChartFormat<ActionType>;

  private readonly actorIndex: Map<string, BCFActor>;
  private readonly actorTypeIndex: Map<string, BCFActor['type']>;
  private readonly tickIndex: Map<number, BCFTick<ActionType>>;
  private readonly cellIndex: Map<string, BCFCell<ActionType>>;
  private readonly customRowIndex: Map<string, BCFCustomRow>;
  private readonly customRowCellIndex: Map<string, BCFCustomRowCell>;
  private readonly splitIndex: Map<number, BCFSplit>;
  private readonly bgColors: ResolvedBackgroundColor[];

  // Cached sorted tick numbers for state resolution.
  private readonly sortedTicks: number[];

  // State resolution cache.
  private readonly stateCache: Map<string, ResolvedActorState>;

  constructor(document: BlertChartFormat<ActionType>) {
    this.doc = document;

    this.actorIndex = new Map();
    this.actorTypeIndex = new Map();
    for (const actor of document.timeline.actors) {
      this.actorIndex.set(actor.id, actor);
      this.actorTypeIndex.set(actor.id, actor.type);
    }

    this.tickIndex = new Map();
    this.cellIndex = new Map();
    const tickNumbers: number[] = [];
    for (const tick of document.timeline.ticks) {
      this.tickIndex.set(tick.tick, tick);
      tickNumbers.push(tick.tick);
      for (const cell of tick.cells) {
        this.cellIndex.set(this.cellKey(cell.actorId, tick.tick), cell);
      }
    }
    this.sortedTicks = tickNumbers.sort((a, b) => a - b);

    this.customRowIndex = new Map();
    this.customRowCellIndex = new Map();
    const customRows = document.augmentation?.customRows ?? [];
    for (const row of customRows) {
      this.customRowIndex.set(row.id, row);
      for (const cell of row.cells) {
        this.customRowCellIndex.set(this.cellKey(row.id, cell.tick), cell);
      }
    }

    this.splitIndex = new Map();
    const splits = document.augmentation?.splits ?? [];
    for (const split of splits) {
      this.splitIndex.set(split.tick, split);
    }

    if (this.doc.augmentation?.backgroundColors !== undefined) {
      this.bgColors = this.doc.augmentation.backgroundColors.map((bg) => ({
        ...bg,
        intensity: bg.intensity ?? 'medium',
        length: bg.length ?? 1,
      }));
    } else {
      this.bgColors = [];
    }

    this.stateCache = new Map();
  }

  /** Chart name, if specified. */
  get name(): string | undefined {
    return this.doc.name;
  }

  /** Chart description, if specified. */
  get description(): string | undefined {
    return this.doc.description;
  }

  /** Total number of ticks in the timeline. */
  get totalTicks(): number {
    return this.doc.config.totalTicks;
  }

  /** Last tick number. */
  get maxTick(): number {
    return this.doc.config.totalTicks - 1;
  }

  /** First display tick. Defaults to 0. */
  get startTick(): number {
    return this.doc.config.startTick ?? 0;
  }

  /** Last display tick (inclusive). Defaults to `maxTick`. */
  get endTick(): number {
    return this.doc.config.endTick ?? this.maxTick;
  }

  /** Returns the number of display ticks. */
  get displayTicks(): number {
    return this.endTick - this.startTick + 1;
  }

  /** Configured background colors. */
  get backgroundColors(): ResolvedBackgroundColor[] {
    return this.bgColors;
  }

  /**
   * Gets an actor by ID.
   * @param id Actor ID
   * @returns The actor, or undefined if not found
   */
  getActor(id: string): BCFActor | undefined {
    return this.actorIndex.get(id);
  }

  /**
   * Gets all actors in document order.
   * @returns Array of all actors
   */
  getActors(): BCFActor[] {
    return this.doc.timeline.actors;
  }

  /**
   * Gets a tick by tick number.
   * @param tick Tick number
   * @returns The tick, or undefined if not found
   */
  getTick(tick: number): BCFTick<ActionType> | undefined {
    return this.tickIndex.get(tick);
  }

  /**
   * Gets a cell for a specific actor at a specific tick.
   * @param actorId Actor ID
   * @param tick Tick number
   * @returns The cell, or undefined if no data on that tick
   */
  getCell(actorId: string, tick: number): BCFCell<ActionType> | undefined {
    return this.cellIndex.get(this.cellKey(actorId, tick));
  }

  /**
   * Returns the cell for a specific player at a specific tick.
   *
   * @param actorId Actor ID of the player
   * @param tick Tick number
   * @returns The cell, or undefined if the actor is not a player or has no data
   *  on that tick
   */
  getPlayerCell(
    actorId: string,
    tick: number,
  ): BCFCell<ActionType> | undefined {
    if (this.getActor(actorId)?.type !== 'player') {
      return undefined;
    }
    return this.getCell(actorId, tick);
  }

  /**
   * Returns the cell for a specific NPC at a specific tick.
   *
   * @param actorId Actor ID of the NPC
   * @param tick Tick number
   * @returns The cell, or undefined if the actor is not an NPC or has no data
   *  on that tick
   */
  getNpcCell(actorId: string, tick: number): BCFCell<ActionType> | undefined {
    if (this.getActor(actorId)?.type !== 'npc') {
      return undefined;
    }
    return this.getCell(actorId, tick);
  }

  /**
   * Gets the resolved state for a player at a specific tick.
   *
   * @param actorId Actor ID
   * @param tick Tick number
   * @returns The player state, or `undefined` if the actor is not a player.
   */
  getPlayerState(
    actorId: string,
    tick: number,
  ): ResolvedPlayerState | undefined {
    if (this.getActor(actorId)?.type !== 'player') {
      return undefined;
    }
    return this.getActorState(actorId, tick) as ResolvedPlayerState | undefined;
  }

  /**
   * Gets the resolved state for an NPC at a specific tick.
   * @param actorId Actor ID
   * @param tick Tick number
   * @returns The NPC state, or `undefined` if the actor is not an NPC.
   */
  getNpcState(actorId: string, tick: number): ResolvedNpcState | undefined {
    if (this.getActor(actorId)?.type !== 'npc') {
      return undefined;
    }
    return this.getActorState(actorId, tick) as ResolvedNpcState | undefined;
  }

  /**
   * Gets the resolved state for an actor at a specific tick.
   *
   * State resolution applies persistent fields from previous ticks and
   * merges non-persistent fields from the current tick.
   *
   * @param actorId Actor ID
   * @param tick Tick number
   * @returns Resolved state, or `undefined` if the actor doesn't exist or the
   *   tick is out of bounds.
   */
  getActorState(actorId: string, tick: number): ResolvedActorState | undefined {
    const actorType = this.actorTypeIndex.get(actorId);
    if (actorType === undefined) {
      return undefined;
    }

    if (tick < 0 || tick > this.maxTick) {
      return undefined;
    }

    const cacheKey = this.cellKey(actorId, tick);
    const cached = this.stateCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    return this.resolveState(actorId, actorType, tick);
  }

  /**
   * Returns the row order if specified.
   * @returns Array of row IDs in display order.
   */
  getRowOrder(): string[] | undefined {
    return this.doc.config.rowOrder;
  }

  /**
   * Gets a custom row by ID.
   * @param id Custom row ID
   * @returns The custom row, or undefined if not found
   */
  getCustomRow(id: string): BCFCustomRow | undefined {
    return this.customRowIndex.get(id);
  }

  /**
   * Gets all custom rows in document order.
   * @returns Array of all custom rows
   */
  getCustomRows(): BCFCustomRow[] {
    return this.doc.augmentation?.customRows ?? [];
  }

  /**
   * Gets a custom row cell at a specific tick.
   * @param rowId Custom row ID
   * @param tick Tick number
   * @returns The cell, or undefined if no data at that tick
   */
  getCustomRowCell(rowId: string, tick: number): BCFCustomRowCell | undefined {
    return this.customRowCellIndex.get(this.cellKey(rowId, tick));
  }

  /**
   * Gets the split at a specific tick, if any.
   * @param tick Tick number
   * @returns The split, or undefined if no split at that tick
   */
  getSplitAtTick(tick: number): BCFSplit | undefined {
    return this.splitIndex.get(tick);
  }

  /**
   * Gets all splits.
   * @returns Array of all splits
   */
  getSplits(): BCFSplit[] {
    return this.doc.augmentation?.splits ?? [];
  }

  /**
   * Gets the background color at a specific tick.
   * If multiple colors overlap, returns the last one defined.
   *
   * @param tick Tick number
   * @param rowId Optional row ID to check row-specific colors
   * @returns The color and intensity, or undefined if no color at that tick
   */
  getBackgroundColorAtTick(
    tick: number,
    rowId?: string,
  ): { color: BCFColor; intensity: BCFColorIntensity } | undefined {
    for (let i = this.bgColors.length - 1; i >= 0; i--) {
      const bg = this.bgColors[i];
      const end = bg.tick + bg.length;
      if (tick < bg.tick || tick >= end) {
        continue;
      }

      if (bg.rowIds === undefined) {
        return { color: bg.color, intensity: bg.intensity };
      }

      if (rowId !== undefined && bg.rowIds.includes(rowId)) {
        return { color: bg.color, intensity: bg.intensity };
      }
    }

    return undefined;
  }

  private cellKey(id: string, tick: number): string {
    return `${id}:${tick}`;
  }

  private resolveState(
    actorId: string,
    actorType: BCFActor['type'],
    tick: number,
  ): ResolvedActorState {
    // Find the most recent cached state.
    let startIdx = 0;
    let persistentState = this.getDefaultPersistentState(actorType);

    for (let i = this.sortedTicks.length - 1; i >= 0; i--) {
      const t = this.sortedTicks[i];
      if (t >= tick) {
        continue;
      }

      const cached = this.stateCache.get(this.cellKey(actorId, t));
      if (cached !== undefined) {
        persistentState = this.extractPersistentState(cached, actorType);
        startIdx = i + 1;
        break;
      }
    }

    // Apply all state changes since the last cached state.
    for (let i = startIdx; i < this.sortedTicks.length; i++) {
      const t = this.sortedTicks[i];
      if (t > tick) {
        break;
      }

      const key = this.cellKey(actorId, t);

      const cell = this.cellIndex.get(key);
      if (cell !== undefined) {
        persistentState = this.applyPersistentChanges(
          persistentState,
          cell,
          actorType,
        );
      }

      // Cache intermediate ticks with full resolved state.
      if (t < tick) {
        const fullState = this.buildFinalState(
          persistentState,
          cell,
          actorType,
        );
        this.stateCache.set(key, fullState);
      }
    }

    // Build and cache the final state for the requested tick.
    const key = this.cellKey(actorId, tick);
    const currentCell = this.cellIndex.get(key);
    const finalState = this.buildFinalState(
      persistentState,
      currentCell,
      actorType,
    );
    this.stateCache.set(key, finalState);
    return finalState;
  }

  private getDefaultPersistentState(
    actorType: BCFActor['type'],
  ): Partial<ResolvedActorState> {
    switch (actorType) {
      case 'player':
        return { isDead: false };
      case 'npc':
        return {};
    }

    const _exhaustive: never = actorType;
    throw new Error(`Unknown actor type: ${_exhaustive as string}`);
  }

  private extractPersistentState(
    cached: ResolvedActorState,
    actorType: BCFActor['type'],
  ): Partial<ResolvedActorState> {
    switch (actorType) {
      case 'player':
        const playerState = cached as ResolvedPlayerState;
        return {
          isDead: playerState.isDead,
          specEnergy: playerState.specEnergy,
        };
      case 'npc':
        return {};
    }

    const _exhaustive: never = actorType;
    throw new Error(`Unknown actor type: ${_exhaustive as string}`);
  }

  private applyPersistentChanges(
    state: Partial<ResolvedActorState>,
    cell: BCFCell<ActionType>,
    actorType: BCFActor['type'],
  ): Partial<ResolvedActorState> {
    if (actorType === 'npc') {
      return state;
    }

    if (actorType === 'player') {
      const playerState = state as ResolvedPlayerState;
      let { isDead, specEnergy } = playerState;

      if (cell.actions?.some((a) => a.type === 'death')) {
        isDead = true;
      }

      const cellState = cell.state;
      if (cellState !== undefined) {
        if ('isDead' in cellState && cellState.isDead !== undefined) {
          isDead = cellState.isDead;
        }
        if ('specEnergy' in cellState && cellState.specEnergy !== undefined) {
          specEnergy = cellState.specEnergy;
        }
      }

      return { isDead, specEnergy };
    }

    const _exhaustive: never = actorType;
    throw new Error(`Unknown actor type: ${_exhaustive as string}`);
  }

  private buildFinalState(
    persistentState: Partial<ResolvedActorState>,
    cell: BCFCell<ActionType> | undefined,
    actorType: BCFActor['type'],
  ): ResolvedActorState {
    const cellState = cell?.state;

    if (actorType === 'npc') {
      // NPCs don't have persistent state.
      const npcState = cellState as BCFNpcState | undefined;
      return {
        label: npcState?.label,
        customStates: npcState?.customStates ?? [],
      };
    }

    if (actorType === 'player') {
      const playerState = persistentState as ResolvedPlayerState;
      const result: ResolvedPlayerState = { ...playerState };

      if (
        cellState !== undefined &&
        'offCooldown' in cellState &&
        cellState.offCooldown !== undefined
      ) {
        result.offCooldown = cellState.offCooldown;
      }
      result.customStates = cellState?.customStates ?? [];

      return result;
    }

    const _exhaustive: never = actorType;
    throw new Error(`Unknown actor type: ${_exhaustive as string}`);
  }
}
