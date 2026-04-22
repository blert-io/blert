import {
  attackDefinitionsById,
  DataSource,
  EquipmentSlot,
  EventJson,
  ItemDelta,
  jsonToProtoEvent,
  NpcAttack,
  PlayerAttack,
  PlayerSpell,
  PrayerSet,
  RawItemDelta,
  SkillLevel,
  Stage,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import {
  EventType,
  GRAPHICS_EVENT_TYPES,
  PlayerTickStateEventType,
  SYNTHETIC_EVENT_SOURCE,
  TaggedEvent,
  TICK_STATE_EVENT_TYPES,
} from './event';
import { QualityFlag } from './quality';

export type WithProvenance<T> = T & {
  sourceClientId: number;
};

type NpcAttacked = {
  type: NpcAttack;
  target: string | null;
};

export type NpcState = WithProvenance<{
  id: number;
  x: number;
  y: number;
  hitpoints: SkillLevel;
  attack: WithProvenance<NpcAttacked> | null;
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
 * Resynchronizes a timeline of tick states, modifying them in place.
 * @param ticks Timeline to resynchronize.
 */
export function resynchronizeTicks(stage: Stage, ticks: TickStateArray): void {
  let prev: TickState | null = null;

  for (const tick of ticks) {
    if (tick !== null) {
      tick.resynchronize(stage, prev);
      prev = tick;
    }
  }
}

export class TickState {
  private tick: number;
  private eventsByType: Map<EventType, TaggedEvent[]>;
  private npcs: Map<number, NpcState>;
  private playerStates: Map<string, PlayerState | null>;

  public static fromEvents(
    tick: number,
    events: TaggedEvent[],
    playerStates: Map<string, PlayerState | null>,
  ): TickState {
    return new TickState(tick, events, playerStates, new Map());
  }

  private constructor(
    tick: number,
    events: TaggedEvent[],
    playerStates: Map<string, PlayerState | null>,
    npcs: Map<number, NpcState>,
  ) {
    this.tick = tick;
    this.playerStates = playerStates;

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

    if (npcs.size > 0) {
      this.npcs = npcs;
    } else {
      this.npcs = new Map();
    }

    events
      .filter(
        (tagged) =>
          tagged.event.getType() === Event.Type.NPC_SPAWN ||
          tagged.event.getType() === Event.Type.NPC_UPDATE,
      )
      .forEach((tagged) => {
        const npc = tagged.event.getNpc()!;
        this.npcs.set(npc.getRoomId(), {
          id: npc.getId(),
          x: tagged.event.getXCoord(),
          y: tagged.event.getYCoord(),
          hitpoints: SkillLevel.fromRaw(npc.getHitpoints()),
          attack: null,
          sourceClientId: tagged.source,
        });
      });

    events
      .filter((tagged) => tagged.event.getType() === Event.Type.NPC_ATTACK)
      .forEach((tagged) => {
        const roomId = tagged.event.getNpc()?.getRoomId();
        if (!roomId) {
          return;
        }

        const state = this.npcs.get(roomId);
        const attack = tagged.event.getNpcAttack();

        if (!state || !attack) {
          return;
        }

        state.attack = {
          type: attack.getAttack(),
          target: attack.getTarget() ?? null,
          sourceClientId: tagged.source,
        };
      });
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

    const npcs = new Map<number, NpcState>();
    for (const [roomId, state] of this.npcs.entries()) {
      npcs.set(roomId, {
        ...state,
        attack: state.attack ? { ...state.attack } : null,
      });
    }

    return new TickState(
      this.tick,
      this.getTaggedEvents().map((t) => ({
        event: t.event.clone(),
        source: t.source,
      })),
      playerStates,
      npcs,
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
        const flag = this.mergePlayerState(player, currentState, otherState);
        if (flag !== null) {
          flags.push(flag);
        }
      }
    }

    for (const [roomId, state] of other.npcs) {
      if (!this.npcs.has(roomId)) {
        this.npcs.set(roomId, { ...state });
        const npcEvents = other
          .getTaggedEvents()
          .filter((t) => t.event.getNpc()?.getRoomId() === roomId);
        this.addTaggedEvents(npcEvents);
      }
    }

    this.mergeGraphicsEvents(other);

    return flags;
  }

  /**
   * Updates the events representing this tick state to reflect any changes in
   * the overall stage state following a merge.
   * @param previous The previous tick state, or null if this is the first tick.
   */
  public resynchronize(stage: Stage, previous: TickState | null): void {
    for (const type of TICK_STATE_EVENT_TYPES) {
      this.eventsByType.delete(type);
    }

    for (const player of this.playerStates.keys()) {
      const state = this.getPlayerState(player);
      if (state === null) {
        continue;
      }
      const previousState = previous?.getPlayerState(player) ?? null;

      this.resynchronizePlayerState(player, state, previousState);
      this.createPlayerStateEvents(stage, player, state, previousState);
    }

    // TODO(frolv): Resynchronize NPC events.

    // TODO(frolv): Resynchronize graphics events.
  }

  /**
   * Merges graphics and positional events from `other` into this tick state.
   * Graphics events from both sides are all kept because visibility may differ
   * between clients, and some are delta-based. They will be resolved into
   * single events during resynchronization.
   *
   * @param other Tick state to merge.
   */
  private mergeGraphicsEvents(other: TickState): void {
    const events = other
      .getTaggedEvents()
      .filter((t) => GRAPHICS_EVENT_TYPES.has(t.event.getType()));
    if (events.length > 0) {
      this.addTaggedEvents(events);
    }
  }

  private mergePlayerState(
    player: string,
    currentState: PlayerState,
    otherState: PlayerState,
  ): QualityFlag | null {
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

    return null;
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
    const events: TaggedEvent[] = [];

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
    events.push({
      event: jsonToProtoEvent(updateEvent),
      source: state.sourceClientId,
    });

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

      events.push({
        event: jsonToProtoEvent(attackEvent),
        source: state.attack.sourceClientId,
      });
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

      events.push({
        event: jsonToProtoEvent(spellEvent),
        source: state.spell.sourceClientId,
      });
    }

    if (events.length > 0) {
      this.addTaggedEvents(events);
    }
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
