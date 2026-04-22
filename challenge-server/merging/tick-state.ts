import {
  attackDefinitionsById,
  DataSource,
  EquipmentSlot,
  EventJson,
  ItemDelta,
  jsonToProtoEvent,
  MaidenCrabProperties,
  NpcAttack,
  NyloProperties,
  PlayerAttack,
  PlayerSpell,
  PrayerSet,
  RawItemDelta,
  RoomNpcType,
  SkillLevel,
  Stage,
  VerzikCrabProperties,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import {
  Assert,
  Equals,
  EventType,
  PlayerTickStateEventType,
  SYNTHETIC_EVENT_SOURCE,
  TaggedEvent,
  TICK_STATE_EVENT_TYPES,
} from './event';
import { cloneGraphics, createGraphicsEvents, GraphicsState } from './graphics';
import { QualityFlag } from './quality';

export type WithProvenance<T> = T & {
  sourceClientId: number;
};

export type NpcAttacked = {
  type: NpcAttack;
  target: string | null;
};

export type NpcSubtype =
  | { type: RoomNpcType.MAIDEN_CRAB; maidenCrab: MaidenCrabProperties }
  | { type: RoomNpcType.NYLO; nylo: NyloProperties }
  | { type: RoomNpcType.VERZIK_CRAB; verzikCrab: VerzikCrabProperties };

// Compile-time exhaustive check: every `RoomNpcType` except `BASIC` must have
// an `NpcSubtype` variant. Adding a new sub-type without updating
// `NpcSubtype` will fail to compile.
type _NpcSubtypeExhaustive = Assert<
  Equals<NpcSubtype['type'], Exclude<RoomNpcType, RoomNpcType.BASIC>>
>;

export type NpcState = WithProvenance<{
  id: number;
  x: number;
  y: number;
  hitpoints: SkillLevel;
  prayers: PrayerSet;
  attack: WithProvenance<NpcAttacked> | null;
  subtype: NpcSubtype | null;
}>;

export type EquippedItem = {
  id: number;
  quantity: number;
};

export type PlayerAttacked = {
  type: PlayerAttack;
  weaponId: number;
  distanceToTarget: number;
  target: WithProvenance<{
    id: number;
    roomId: number;
  }> | null;
};

export type SpellTarget =
  | { kind: 'player'; name: string }
  | { kind: 'npc'; id: number; roomId: number };

export type SpellCast = {
  type: PlayerSpell;
  target: WithProvenance<SpellTarget> | null;
};

export type PlayerStats = {
  hitpoints: SkillLevel | null;
  prayer: SkillLevel | null;
  attack: SkillLevel | null;
  strength: SkillLevel | null;
  defence: SkillLevel | null;
  ranged: SkillLevel | null;
  magic: SkillLevel | null;
};

export type PlayerState = WithProvenance<{
  source: DataSource;
  username: string;
  x: number;
  y: number;
  isDead: boolean;
  equipment: Record<EquipmentSlot, EquippedItem | null>;
  prayers: PrayerSet;
  attack: WithProvenance<PlayerAttacked> | null;
  spell: WithProvenance<SpellCast> | null;
  stats: PlayerStats | null;
  offCooldownTick: number | null;
}>;

export type TickStateArray = (TickState | null)[];

/**
 * Deep-copies an NPC state map. Used when forwarding existing state through
 * a tick rebuild without sharing mutable references with the source map.
 */
export function cloneNpcs(
  npcs: ReadonlyMap<number, NpcState>,
): Map<number, NpcState> {
  const copy = new Map<number, NpcState>();
  for (const [roomId, state] of npcs) {
    copy.set(roomId, {
      ...state,
      prayers: PrayerSet.fromRaw(state.prayers.getRaw()),
      attack: state.attack ? { ...state.attack } : null,
      subtype: cloneNpcSubtype(state.subtype),
    });
  }
  return copy;
}

/**
 * Deep-copies an `NpcSubtype` discriminated union, or passes through `null`.
 */
function cloneNpcSubtype(subtype: NpcSubtype | null): NpcSubtype | null {
  if (subtype === null) {
    return null;
  }
  switch (subtype.type) {
    case RoomNpcType.MAIDEN_CRAB:
      return { type: subtype.type, maidenCrab: { ...subtype.maidenCrab } };
    case RoomNpcType.NYLO:
      return { type: subtype.type, nylo: { ...subtype.nylo } };
    case RoomNpcType.VERZIK_CRAB:
      return { type: subtype.type, verzikCrab: { ...subtype.verzikCrab } };
  }

  const _exhaustive: never = subtype;
  return null;
}

/**
 * Extracts an NPC's sub-type fields from a proto event.
 *
 * @returns A discriminated `NpcSubtype` if the event carried sub-type fields,
 *   or `null` if omitted.
 */
function extractNpcSubtype(npc: Event.Npc): NpcSubtype | null {
  if (npc.hasMaidenCrab()) {
    const crab = npc.getMaidenCrab()!;
    return {
      type: RoomNpcType.MAIDEN_CRAB,
      maidenCrab: {
        spawn: crab.getSpawn(),
        position: crab.getPosition(),
        scuffed: crab.getScuffed(),
      },
    };
  }
  if (npc.hasNylo()) {
    const nylo = npc.getNylo()!;
    return {
      type: RoomNpcType.NYLO,
      nylo: {
        wave: nylo.getWave(),
        parentRoomId: nylo.getParentRoomId(),
        big: nylo.getBig(),
        style: nylo.getStyle(),
        spawnType: nylo.getSpawnType(),
      },
    };
  }
  if (npc.hasVerzikCrab()) {
    const crab = npc.getVerzikCrab()!;
    return {
      type: RoomNpcType.VERZIK_CRAB,
      verzikCrab: {
        phase: crab.getPhase(),
        spawn: crab.getSpawn(),
      },
    };
  }
  return null;
}

/**
 * Builds the NPC state map for a single tick from its events, carrying
 * `subtype` forward from the previous tick's map when an NPC's event on this
 * tick doesn't carry fresh sub-type fields.
 *
 * @param events Tagged events for this tick.
 * @param previous The NPC state map from the immediately preceding tick, or
 *   `null` if this is the first tick.
 * @returns The NPC state map for this tick.
 */
export function buildNpcsForTick(
  events: TaggedEvent[],
  previous: Map<number, NpcState> | null,
): Map<number, NpcState> {
  const npcs = new Map<number, NpcState>();

  for (const tagged of events) {
    const type = tagged.event.getType();
    if (type !== Event.Type.NPC_SPAWN && type !== Event.Type.NPC_UPDATE) {
      continue;
    }
    const npc = tagged.event.getNpc()!;
    const roomId = npc.getRoomId();
    const fresh = extractNpcSubtype(npc);
    npcs.set(roomId, {
      id: npc.getId(),
      x: tagged.event.getXCoord(),
      y: tagged.event.getYCoord(),
      hitpoints: SkillLevel.fromRaw(npc.getHitpoints()),
      prayers: PrayerSet.fromRaw(npc.getActivePrayers()),
      attack: null,
      subtype: fresh ?? previous?.get(roomId)?.subtype ?? null,
      sourceClientId: tagged.source,
    });
  }

  for (const tagged of events) {
    if (tagged.event.getType() !== Event.Type.NPC_ATTACK) {
      continue;
    }
    const roomId = tagged.event.getNpc()?.getRoomId();
    if (roomId === undefined) {
      continue;
    }
    const state = npcs.get(roomId);
    const attack = tagged.event.getNpcAttack();
    if (!state || !attack) {
      continue;
    }
    state.attack = {
      type: attack.getAttack(),
      target: attack.hasTarget() ? attack.getTarget() : null,
      sourceClientId: tagged.source,
    };
  }

  return npcs;
}

/**
 * Builds NPC state maps for an entire client's tick range, threading
 * carried-forward state across ticks. Returns a parallel array indexed by
 * tick.
 */
export function buildNpcStates(
  eventsByTick: TaggedEvent[][],
): Map<number, NpcState>[] {
  const result: Map<number, NpcState>[] = [];
  for (const events of eventsByTick) {
    result.push(buildNpcsForTick(events, result.at(-1) ?? null));
  }
  return result;
}

/**
 * Accumulated context for {@link TickState.resynchronize}. The driver
 * `resynchronizeTicks` builds and updates it as it walks the timeline,
 * passing a read-only view to each tick.
 */
export type ResyncContext = {
  previousPlayers: ReadonlyMap<string, PlayerState>;
  previousNpcs: ReadonlyMap<number, NpcState>;
  previousGraphics: Readonly<GraphicsState> | null;
  deadPlayers: ReadonlySet<string>;
  deadNpcs: ReadonlySet<number>;
};

/**
 * Resynchronizes a timeline of tick states, creating canonical events.
 * Modifies the tick states in place.
 *
 * @param stage The stage in which the events occur.
 * @param ticks Timeline to resynchronize.
 */
export function resynchronizeTicks(stage: Stage, ticks: TickStateArray): void {
  const previousPlayers = new Map<string, PlayerState>();
  const previousNpcs = new Map<number, NpcState>();
  const deadPlayers = new Set<string>();
  const deadNpcs = new Set<number>();
  let previousGraphics: GraphicsState | null = null;

  for (const tick of ticks) {
    if (tick === null) {
      continue;
    }

    tick.resynchronize(stage, {
      previousPlayers,
      previousNpcs,
      previousGraphics,
      deadPlayers,
      deadNpcs,
    });

    for (const [player, state] of tick.getPlayerStates()) {
      if (state !== null) {
        previousPlayers.set(player, state);
      }
    }
    for (const [roomId, state] of tick.getNpcs()) {
      previousNpcs.set(roomId, state);
    }
    previousGraphics = tick.getGraphics();

    // Mark actor deaths starting from the following tick.
    for (const death of tick.getEventsByType(Event.Type.PLAYER_DEATH)) {
      const name = death.getPlayer()?.getName();
      if (name) {
        deadPlayers.add(name);
      }
    }
    for (const death of tick.getEventsByType(Event.Type.NPC_DEATH)) {
      const roomId = death.getNpc()?.getRoomId();
      if (roomId !== undefined) {
        deadNpcs.add(roomId);
      }
    }
  }
}

export class TickState {
  private tick: number;
  private eventsByType: Map<EventType, TaggedEvent[]>;
  private npcs: Map<number, NpcState>;
  private playerStates: Map<string, PlayerState | null>;
  private graphics: GraphicsState;

  public constructor(
    tick: number,
    events: TaggedEvent[],
    playerStates: Map<string, PlayerState | null>,
    npcs: Map<number, NpcState>,
    graphics: GraphicsState,
  ) {
    this.tick = tick;
    this.playerStates = playerStates;
    this.npcs = npcs;
    this.graphics = graphics;

    this.eventsByType = new Map();
    for (const tagged of events) {
      if (TICK_STATE_EVENT_TYPES.has(tagged.event.getType())) {
        // Don't store raw state-level events, only the rebuilt state. Canonical
        // events will be reconstructed during resynchronization.
        continue;
      }

      if (!this.eventsByType.has(tagged.event.getType())) {
        this.eventsByType.set(tagged.event.getType(), []);
      }
      this.eventsByType.get(tagged.event.getType())!.push(tagged);
    }
  }

  /**
   * @returns The tick whose state is represented.
   */
  public getTick(): number {
    return this.tick;
  }

  /**
   * @returns All events recorded on this tick (unwrapped).
   */
  public getEvents(): Event[] {
    const events: Event[] = [];
    for (const tagged of this.eventsByType.values()) {
      for (const t of tagged) {
        events.push(t.event);
      }
    }
    return events;
  }

  /**
   * Retrieves all events of the given type recorded on this tick (unwrapped).
   * @param type The type of events to retrieve.
   * @returns The events of the given type.
   */
  public getEventsByType(type: EventType): Event[] {
    return (this.eventsByType.get(type) ?? []).map((t) => t.event);
  }

  /**
   * @returns All tagged events recorded on this tick.
   */
  public getTaggedEvents(): TaggedEvent[] {
    const events: TaggedEvent[] = [];
    for (const tagged of this.eventsByType.values()) {
      events.push(...tagged);
    }
    return events;
  }

  /**
   * Retrieves all tagged events of the given type recorded on this tick.
   * @param type The type of events to retrieve.
   * @returns The tagged events of the given type.
   */
  public getTaggedEventsByType(type: EventType): TaggedEvent[] {
    return this.eventsByType.get(type) ?? [];
  }

  /**
   * Returns the states of all players on this tick.
   * @returns A map of usernames to player states.
   */
  public getPlayerStates(): Readonly<Map<string, PlayerState | null>> {
    return this.playerStates;
  }

  /**
   * Retrieves the state of the player with the given username on this tick.
   *
   * @param player The username of the player to retrieve.
   * @returns The player state, or `null` if the player is not present.
   */
  public getPlayerState(player: string): Readonly<PlayerState | null> {
    return this.playerStates.get(player) ?? null;
  }

  /**
   * Returns the states of all NPCs on this tick.
   * @returns A map of room IDs to NPC states.
   */
  public getNpcs(): Readonly<Map<number, NpcState>> {
    return this.npcs;
  }

  /**
   * Retrieves the state of the NPC with the given room ID on this tick.
   *
   * @param roomId The room ID of the NPC to retrieve.
   * @returns The NPC state, or `null` if the NPC is not present.
   */
  public getNpcState(roomId: number): Readonly<NpcState | null> {
    return this.npcs.get(roomId) ?? null;
  }

  /**
   * @returns The graphics state for all active types on this tick.
   */
  public getGraphics(): Readonly<GraphicsState> {
    return this.graphics;
  }

  /**
   * Creates a deep copy of this tick state and its events.
   * @returns Cloned tick state.
   */
  public clone(): TickState {
    const playerStates = new Map<string, PlayerState | null>();
    for (const [player, state] of this.playerStates.entries()) {
      if (state !== null) {
        playerStates.set(player, {
          ...state,
          equipment: { ...state.equipment },
          prayers: PrayerSet.fromRaw(state.prayers.getRaw()),
        });
      } else {
        playerStates.set(player, null);
      }
    }

    return new TickState(
      this.tick,
      this.getTaggedEvents().map((t) => ({
        event: t.event.clone(),
        source: t.source,
      })),
      playerStates,
      cloneNpcs(this.npcs),
      cloneGraphics(this.graphics),
    );
  }

  /**
   * Merges events from `other` into this tick state.
   *
   * Events that exist in `other` but not in this tick are added to the state.
   * If an event exists in both, per-event priority is used to determine which
   * data to keep from the two. For example, an event containing first-party
   * data will overwrite an event containing third-party data.
   *
   * @param other The state to merge.
   * @returns Quality flags describing any anomalies encountered during the
   *   merge. An empty array indicates a clean merge.
   */
  public merge(other: TickState): QualityFlag[] {
    const flags: QualityFlag[] = [];

    for (const [player, otherState] of other.playerStates.entries()) {
      if (otherState === null) {
        continue;
      }

      const currentState = this.getPlayerState(player);
      if (currentState === null) {
        this.playerStates.set(player, { ...otherState });
      } else {
        this.mergePlayerState(player, currentState, otherState);
      }
    }

    // NPCs have no primary/secondary state, so NPCs that appear in both keep
    // the base view.
    for (const [roomId, otherState] of other.npcs) {
      if (!this.npcs.has(roomId)) {
        this.npcs.set(roomId, { ...otherState });
      }
    }

    this.mergeGraphics(other);

    return flags;
  }

  /**
   * Updates the events representing this tick state to reflect any changes in
   * the overall stage state following a merge. See {@link ResyncContext} for
   * what's threaded across ticks.
   */
  public resynchronize(stage: Stage, ctx: ResyncContext): void {
    for (const type of TICK_STATE_EVENT_TYPES) {
      this.eventsByType.delete(type);
    }

    for (const player of this.playerStates.keys()) {
      if (ctx.deadPlayers.has(player)) {
        continue;
      }
      const state = this.getPlayerState(player);
      if (state === null) {
        continue;
      }
      const previousState = ctx.previousPlayers.get(player) ?? null;

      this.resynchronizePlayerState(player, state, previousState);
      this.createPlayerStateEvents(stage, player, state, previousState);
    }

    this.createNpcStateEvents(stage, ctx.previousNpcs, ctx.deadNpcs);

    this.addSyntheticEvents(
      createGraphicsEvents(
        this.graphics,
        ctx.previousGraphics,
        stage,
        this.tick,
      ),
    );
  }

  /**
   * Set-unions `other`'s graphics state into this tick. For each type, coords
   * present in `other` but not the base are added with `other`'s source
   * client; existing entries keep their original observer.
   *
   * @param other Tick state whose graphics to merge in.
   */
  private mergeGraphics(other: TickState): void {
    for (const [type, otherCoords] of other.graphics) {
      let coords = this.graphics.get(type);
      if (coords === undefined) {
        coords = new Map();
        this.graphics.set(type, coords);
      }
      for (const [key, source] of otherCoords) {
        if (!coords.has(key)) {
          coords.set(key, source);
        }
      }
    }
  }

  private mergePlayerState(
    player: string,
    currentState: PlayerState,
    otherState: PlayerState,
  ): void {
    const override =
      currentState.source === DataSource.SECONDARY &&
      otherState.source === DataSource.PRIMARY;

    if (override) {
      this.playerStates.set(player, {
        ...otherState,
        attack: currentState.attack,
        spell: currentState.spell,
      });
    }
  }

  /**
   * Sets a player's attack on this tick.
   *
   * @param player The player who attacked.
   * @param attack The attack to set.
   */
  public setPlayerAttack(
    player: string,
    attack: WithProvenance<PlayerAttacked> | null,
  ): void {
    const state = this.playerStates.get(player);
    if (state) {
      state.attack = attack;
    }
  }

  /**
   * Sets a player's spell on this tick.
   *
   * @param player The player who cast the spell.
   * @param spell The spell to set.
   */
  public setPlayerSpell(
    player: string,
    spell: WithProvenance<SpellCast> | null,
  ): void {
    const state = this.playerStates.get(player);
    if (state) {
      state.spell = spell;
    }
  }

  /**
   * Sets an NPC's attack on this tick.
   *
   * @param roomId Room ID of the attacking NPC.
   * @param attack The attack to set, or `null` to clear.
   */
  public setNpcAttack(
    roomId: number,
    attack: WithProvenance<NpcAttacked> | null,
  ): void {
    const state = this.npcs.get(roomId);
    if (state) {
      state.attack = attack;
    }
  }

  /**
   * Removes and returns all tagged events of the given types from this tick.
   * @param types Event types to extract.
   * @returns The extracted tagged events.
   */
  public extractEvents(types: ReadonlySet<EventType>): TaggedEvent[] {
    const extracted: TaggedEvent[] = [];
    for (const type of types) {
      const tagged = this.eventsByType.get(type);
      if (tagged !== undefined) {
        extracted.push(...tagged);
        this.eventsByType.delete(type);
      }
    }
    return extracted;
  }

  /**
   * Adds tagged events to this tick, preserving their provenance.
   * @param events The tagged events to add.
   */
  public addTaggedEvents(events: TaggedEvent[]): void {
    for (const tagged of events) {
      if (!this.eventsByType.has(tagged.event.getType())) {
        this.eventsByType.set(tagged.event.getType(), []);
      }
      this.eventsByType.get(tagged.event.getType())!.push(tagged);
    }
  }

  /**
   * Adds events to this tick without provenance.
   * @param events The events to add.
   */
  public addSyntheticEvents(events: Event[]): void {
    this.addTaggedEvents(
      events.map((event) => ({ event, source: SYNTHETIC_EVENT_SOURCE })),
    );
  }

  /**
   * Resynchronizes the state of the given player on this tick.
   * @param player The player whose state to resynchronize.
   * @param state The current state of the player.
   * @param previous The previous state of the player, or null if this is the
   *   first tick.
   */
  private resynchronizePlayerState(
    player: string,
    state: PlayerState,
    previous: PlayerState | null,
  ): void {
    if (state.attack !== null) {
      const cooldown = attackDefinitionsById.get(state.attack.type)?.cooldown;
      if (cooldown !== undefined) {
        state.offCooldownTick = this.tick + cooldown;
      }
    }

    state.offCooldownTick ??= previous?.offCooldownTick ?? 0;
  }

  private createPlayerStateEvents(
    stage: Stage,
    player: string,
    state: PlayerState,
    previous: PlayerState | null,
  ): void {
    const events: Event[] = [];

    const basePlayerEvent = (type: PlayerTickStateEventType): EventJson => ({
      type,
      stage,
      tick: this.tick,
      xCoord: state.x,
      yCoord: state.y,
      player: { name: player },
    });

    const updateEvent = basePlayerEvent(Event.Type.PLAYER_UPDATE);
    const p = updateEvent.player!;
    p.dataSource = state.source;
    p.activePrayers = state.prayers.getRaw();
    p.equipmentDeltas = createEquipmentDeltas(state, previous);
    p.offCooldownTick = state.offCooldownTick!; // Safe after resync
    if (state.stats !== null) {
      if (state.stats.hitpoints !== null) {
        p.hitpoints = state.stats.hitpoints.toRaw();
      }
      if (state.stats.prayer !== null) {
        p.prayer = state.stats.prayer.toRaw();
      }
      if (state.stats.attack !== null) {
        p.attack = state.stats.attack.toRaw();
      }
      if (state.stats.strength !== null) {
        p.strength = state.stats.strength.toRaw();
      }
      if (state.stats.defence !== null) {
        p.defence = state.stats.defence.toRaw();
      }
      if (state.stats.ranged !== null) {
        p.ranged = state.stats.ranged.toRaw();
      }
      if (state.stats.magic !== null) {
        p.magic = state.stats.magic.toRaw();
      }
    }
    events.push(jsonToProtoEvent(updateEvent));

    if (state.attack !== null) {
      const attackEvent: EventJson = {
        ...basePlayerEvent(Event.Type.PLAYER_ATTACK),
        playerAttack: {
          type: state.attack.type,
          distanceToTarget: state.attack.distanceToTarget,
          weapon: {
            slot: EquipmentSlot.WEAPON,
            id: state.attack.weaponId,
            quantity: 1,
          },
        },
      };

      if (state.attack.target !== null) {
        attackEvent.playerAttack!.target = {
          id: state.attack.target.id,
          roomId: state.attack.target.roomId,
        };
      }

      events.push(jsonToProtoEvent(attackEvent));
    }

    if (state.spell !== null) {
      const spellEvent: EventJson = {
        ...basePlayerEvent(Event.Type.PLAYER_SPELL),
        playerSpell: { type: state.spell.type },
      };

      if (state.spell.target !== null) {
        if (state.spell.target.kind === 'player') {
          spellEvent.playerSpell!.targetPlayer = state.spell.target.name;
        } else {
          spellEvent.playerSpell!.targetNpc = {
            id: state.spell.target.id,
            roomId: state.spell.target.roomId,
          };
        }
      }

      events.push(jsonToProtoEvent(spellEvent));
    }

    if (events.length > 0) {
      this.addSyntheticEvents(events);
    }
  }

  /**
   * Synthesizes canonical NPC events from `npcs` for this tick, skipping those
   * whose canonical event for this tick is an NPC_SPAWN.
   *
   * Sub-type fields are emitted only on ticks where they differ from the
   * NPC's last-known sub-type, matching event wire semantics.
   *
   * @param previousNpcs Last-known state for each NPC, used for sub-type
   *   delta emission.
   */
  private createNpcStateEvents(
    stage: Stage,
    previousNpcs: ReadonlyMap<number, NpcState>,
    deadNpcs: ReadonlySet<number>,
  ): void {
    const events: Event[] = [];

    const spawnedRoomIds = new Set<number>();
    for (const event of this.getEventsByType(Event.Type.NPC_SPAWN)) {
      const roomId = event.getNpc()?.getRoomId();
      if (roomId !== undefined) {
        spawnedRoomIds.add(roomId);
      }
    }

    for (const [roomId, state] of this.npcs) {
      if (deadNpcs.has(roomId)) {
        continue;
      }
      if (!spawnedRoomIds.has(roomId)) {
        const previousSubtype = previousNpcs.get(roomId)?.subtype ?? null;
        const updateEvent: EventJson = {
          type: Event.Type.NPC_UPDATE,
          stage,
          tick: this.tick,
          xCoord: state.x,
          yCoord: state.y,
          npc: {
            id: state.id,
            roomId,
            hitpoints: state.hitpoints.toRaw(),
            activePrayers: state.prayers.getRaw(),
          },
        };
        if (
          state.subtype !== null &&
          !npcSubtypesEqual(state.subtype, previousSubtype)
        ) {
          applyNpcSubtype(updateEvent.npc!, state.subtype);
        }
        events.push(jsonToProtoEvent(updateEvent));
      }

      if (state.attack !== null) {
        const attackEvent: EventJson = {
          type: Event.Type.NPC_ATTACK,
          stage,
          tick: this.tick,
          xCoord: state.x,
          yCoord: state.y,
          npc: { id: state.id, roomId },
          npcAttack: { attack: state.attack.type },
        };
        if (state.attack.target !== null) {
          attackEvent.npcAttack!.target = state.attack.target;
        }
        events.push(jsonToProtoEvent(attackEvent));
      }
    }

    if (events.length > 0) {
      this.addSyntheticEvents(events);
    }
  }
}

function npcSubtypesEqual(a: NpcSubtype | null, b: NpcSubtype | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a.type !== b.type) {
    return false;
  }
  switch (a.type) {
    case RoomNpcType.MAIDEN_CRAB: {
      const bm = (b as Extract<NpcSubtype, { type: RoomNpcType.MAIDEN_CRAB }>)
        .maidenCrab;
      return (
        a.maidenCrab.spawn === bm.spawn &&
        a.maidenCrab.position === bm.position &&
        a.maidenCrab.scuffed === bm.scuffed
      );
    }
    case RoomNpcType.NYLO: {
      const bn = (b as Extract<NpcSubtype, { type: RoomNpcType.NYLO }>).nylo;
      return (
        a.nylo.wave === bn.wave &&
        a.nylo.parentRoomId === bn.parentRoomId &&
        a.nylo.big === bn.big &&
        a.nylo.style === bn.style &&
        a.nylo.spawnType === bn.spawnType
      );
    }
    case RoomNpcType.VERZIK_CRAB: {
      const bv = (b as Extract<NpcSubtype, { type: RoomNpcType.VERZIK_CRAB }>)
        .verzikCrab;
      return a.verzikCrab.phase === bv.phase && a.verzikCrab.spawn === bv.spawn;
    }
  }
}

function applyNpcSubtype(
  npc: NonNullable<EventJson['npc']>,
  subtype: NpcSubtype,
): void {
  switch (subtype.type) {
    case RoomNpcType.MAIDEN_CRAB:
      npc.maidenCrab = subtype.maidenCrab;
      break;
    case RoomNpcType.NYLO:
      npc.nylo = subtype.nylo;
      break;
    case RoomNpcType.VERZIK_CRAB:
      npc.verzikCrab = subtype.verzikCrab;
      break;
  }
}

function createEquipmentDeltas(
  state: PlayerState,
  previous: PlayerState | null,
): RawItemDelta[] {
  const newDeltas: RawItemDelta[] = [];

  for (let slot = EquipmentSlot.HEAD; slot <= EquipmentSlot.QUIVER; slot++) {
    const prev = previous?.equipment[slot];
    const curr = state.equipment[slot];

    if (curr) {
      if (prev?.id !== curr.id) {
        newDeltas.push(
          new ItemDelta(curr.id, curr.quantity, slot, true).toRaw(),
        );
      } else {
        const delta = curr.quantity - prev.quantity;
        if (delta !== 0) {
          newDeltas.push(
            new ItemDelta(curr.id, Math.abs(delta), slot, delta > 0).toRaw(),
          );
        }
      }
    } else if (prev) {
      newDeltas.push(
        new ItemDelta(prev.id, prev.quantity, slot, false).toRaw(),
      );
    }
  }

  return newDeltas;
}
