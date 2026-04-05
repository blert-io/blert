import {
  DataSource,
  EquipmentSlot,
  ItemDelta,
  NpcAttack,
  PlayerAttack,
  PrayerSet,
  RawItemDelta,
  SkillLevel,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import {
  EventType,
  GRAPHICS_EVENT_TYPES,
  PLAYER_TICK_STATE_TYPES,
  SYNTHETIC_EVENT_SOURCE,
  TaggedEvent,
} from './event';

type NpcAttacked = {
  type: NpcAttack;
  target: string | null;
};

export type NpcState = {
  id: number;
  x: number;
  y: number;
  hitpoints: SkillLevel;
  attack: NpcAttacked | null;
};

export type EquippedItem = {
  id: number;
  quantity: number;
};

type PlayerAttacked = {
  type: PlayerAttack;
  weaponId: number;
  target: number | null;
};

export type PlayerState = {
  source: DataSource;
  username: string;
  x: number;
  y: number;
  isDead: boolean;
  equipment: Record<EquipmentSlot, EquippedItem | null>;
  attack: PlayerAttacked | null;
  prayers: PrayerSet;
};

export type TickStateArray = (TickState | null)[];

export class TickState {
  private tick: number;
  private eventsByType: Map<EventType, TaggedEvent[]>;
  private npcs: Map<number, NpcState>;
  private playerStates: Map<string, PlayerState | null>;

  public constructor(
    tick: number,
    events: TaggedEvent[],
    playerStates: Map<string, PlayerState | null>,
  ) {
    this.tick = tick;
    this.playerStates = playerStates;

    this.eventsByType = new Map();
    for (const tagged of events) {
      if (!this.eventsByType.has(tagged.event.getType())) {
        this.eventsByType.set(tagged.event.getType(), []);
      }
      this.eventsByType.get(tagged.event.getType())!.push(tagged);
    }

    this.npcs = new Map();

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
        });
      });

    this.eventsByType.get(Event.Type.NPC_ATTACK)?.forEach((tagged) => {
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

    return new TickState(
      this.tick,
      this.getTaggedEvents().map((t) => ({
        event: t.event.clone(),
        source: t.source,
      })),
      playerStates,
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
   * @returns Whether the merge was successful.
   */
  public merge(other: TickState): boolean {
    for (const [player, otherState] of other.playerStates.entries()) {
      if (otherState === null) {
        continue;
      }

      const currentState = this.getPlayerState(player);
      const shouldUpdate =
        !currentState ||
        (currentState.source === DataSource.SECONDARY &&
          otherState.source === DataSource.PRIMARY);

      if (shouldUpdate) {
        this.overridePlayerState(player, other);
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

    return true;
  }

  /**
   * Updates the events representing this tick state to reflect any changes in
   * the overall stage state following a merge.
   * @param tickStates Updated tick states for the entire stage.
   */
  public resynchronize(tickStates: (TickState | null)[]): void {
    for (const player of this.playerStates.keys()) {
      this.resynchronizePlayer(player, tickStates);
    }

    // TODO(frolv): Resynchronize graphics events.
  }

  private resynchronizePlayer(
    player: string,
    tickStates: (TickState | null)[],
  ): void {
    const state = this.getPlayerState(player);
    if (!state) {
      return;
    }

    const updateTagged = this.eventsByType
      .get(Event.Type.PLAYER_UPDATE)
      ?.find((t) => t.event.getPlayer()?.getName() === player);
    if (!updateTagged) {
      return;
    }

    let lastState = null;
    for (let tick = this.tick - 1; tick >= 0; tick--) {
      const previous = tickStates[tick]?.getPlayerState(player) ?? null;
      if (previous !== null) {
        lastState = previous;
        break;
      }
    }

    const newDeltas: RawItemDelta[] = [];

    for (let slot = EquipmentSlot.HEAD; slot <= EquipmentSlot.QUIVER; slot++) {
      const previous = lastState?.equipment[slot];
      const current = state.equipment[slot];

      if (current) {
        if (previous?.id !== current.id) {
          newDeltas.push(
            new ItemDelta(current.id, current.quantity, slot, true).toRaw(),
          );
        } else {
          const delta = current.quantity - previous.quantity;
          if (delta !== 0) {
            newDeltas.push(
              new ItemDelta(
                current.id,
                Math.abs(delta),
                slot,
                delta > 0,
              ).toRaw(),
            );
          }
        }
      } else if (previous) {
        newDeltas.push(
          new ItemDelta(previous.id, previous.quantity, slot, false).toRaw(),
        );
      }
    }

    updateTagged.event.getPlayer()!.setEquipmentDeltasList(newDeltas);
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

  private overridePlayerState(player: string, other: TickState): void {
    for (const type of PLAYER_TICK_STATE_TYPES) {
      const tagged = this.eventsByType.get(type);
      if (tagged !== undefined) {
        this.eventsByType.set(
          type,
          tagged.filter((t) => t.event.getPlayer()?.getName() !== player),
        );
      }
    }

    this.playerStates.set(player, { ...other.getPlayerState(player)! });

    const playerEvents = other
      .getTaggedEvents()
      .filter(
        (t) =>
          PLAYER_TICK_STATE_TYPES.has(t.event.getType()) &&
          t.event.getPlayer()?.getName() === player,
      );
    this.addTaggedEvents(playerEvents);
  }

  /**
   * Replaces a player's attack event and state with the given replacement.
   *
   * @param player The player whose attack to replace.
   * @param attackEvent The new attack event.
   */
  public replacePlayerAttack(player: string, attackEvent: TaggedEvent): void {
    const state = this.playerStates.get(player);
    const attacks = this.eventsByType.get(Event.Type.PLAYER_ATTACK) ?? [];

    const idx = attacks.findIndex(
      (t) => t.event.getPlayer()?.getName() === player,
    );
    if (!state || idx === -1) {
      return;
    }

    attacks[idx] = attackEvent;
    state.attack!.type = attackEvent.event.getPlayerAttack()!.getType();
  }

  /**
   * Removes and returns all tagged events of the given types from this tick
   * state.
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
   * Adds tagged events to this tick state, preserving their provenance.
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
   * Adds events to this tick state with no provenance.
   * @param events The events to add.
   */
  public addSyntheticEvents(events: Event[]): void {
    this.addTaggedEvents(
      events.map((event) => ({ event, source: SYNTHETIC_EVENT_SOURCE })),
    );
  }
}
