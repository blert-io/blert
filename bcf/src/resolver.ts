import type {
  BlertChartFormat,
  BCFAction,
  BCFActor,
  BCFNpcPhaseAction,
  BCFPhase,
  BCFTick,
  BCFCell,
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
}

/**
 * Resolved state for an NPC at a specific tick.
 *
 * Currently empty as there is no NPC-specific state.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ResolvedNpcState {}

export type ResolvedActorState = ResolvedPlayerState | ResolvedNpcState;

/**
 * An NPC phase with its tick.
 */
export interface NpcPhase {
  /** The tick at which the phase occurs. */
  tick: number;
  /** The phase type identifier. */
  phaseType: string;
}

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
  private readonly npcPhaseIndex: Map<string, NpcPhase[]>;
  private readonly encounterPhases: BCFPhase[];

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
    this.npcPhaseIndex = new Map();
    const tickNumbers: number[] = [];
    for (const tick of document.timeline.ticks) {
      this.tickIndex.set(tick.tick, tick);
      tickNumbers.push(tick.tick);
      for (const cell of tick.cells) {
        this.cellIndex.set(this.cellKey(cell.actorId, tick.tick), cell);

        // Index NPC phase actions.
        if (cell.actions !== undefined) {
          for (const action of cell.actions) {
            if (action.type === 'npcPhase') {
              const phaseAction = action as unknown as BCFNpcPhaseAction;
              let phases = this.npcPhaseIndex.get(cell.actorId);
              if (phases === undefined) {
                phases = [];
                this.npcPhaseIndex.set(cell.actorId, phases);
              }
              phases.push({
                tick: tick.tick,
                phaseType: phaseAction.phaseType,
              });
            }
          }
        }
      }
    }
    this.sortedTicks = tickNumbers.sort((a, b) => a - b);

    this.encounterPhases = document.timeline.phases ?? [];

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
   * @returns An iterator over all populated ticks in the timeline.
   */
  *ticks(): IterableIterator<BCFTick<ActionType>> {
    for (const tick of this.sortedTicks) {
      yield this.getTick(tick)!;
    }
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
   * Gets all phase transitions for a specific NPC.
   *
   * Phases are returned in tick order (ascending).
   *
   * @param actorId Actor ID of the NPC
   * @returns Array of phases, or an empty array if the actor is not an NPC or
   *   has no phases.
   */
  getNpcPhases(actorId: string): NpcPhase[] {
    if (this.getActor(actorId)?.type !== 'npc') {
      return [];
    }
    return this.npcPhaseIndex.get(actorId) ?? [];
  }

  /**
   * Gets the spawn tick for an NPC.
   *
   * @param actorId Actor ID of the NPC
   * @returns The spawn tick, or `undefined` if the actor is not an NPC.
   *   Defaults to 0 if not explicitly specified.
   */
  getNpcSpawnTick(actorId: string): number | undefined {
    const actor = this.getActor(actorId);
    if (actor?.type !== 'npc') {
      return undefined;
    }
    return actor.spawnTick ?? 0;
  }

  /**
   * Gets the death tick for an NPC.
   *
   * @param actorId Actor ID of the NPC
   * @returns The death tick, or `undefined` if the actor is not an NPC or
   *   does not have a death tick set.
   */
  getNpcDeathTick(actorId: string): number | undefined {
    const actor = this.getActor(actorId);
    if (actor?.type !== 'npc') {
      return undefined;
    }
    return actor.deathTick;
  }

  /**
   * Gets all encounter-level phase transitions.
   *
   * Phases are returned in tick order (ascending).
   *
   * @returns Array of encounter phases.
   */
  getEncounterPhases(): BCFPhase[] {
    return this.encounterPhases;
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
      // NPCs don't have any state currently.
      return {};
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

      return result;
    }

    const _exhaustive: never = actorType;
    throw new Error(`Unknown actor type: ${_exhaustive as string}`);
  }
}
