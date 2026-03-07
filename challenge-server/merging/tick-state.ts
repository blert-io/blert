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
  offsetEventTick,
  PLAYER_TICK_STATE_TYPES,
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
  private eventsByType: Map<EventType, Event[]>;
  private npcs: Map<number, NpcState>;
  private playerStates: Map<string, PlayerState | null>;

  public constructor(
    tick: number,
    events: Event[],
    playerStates: Map<string, PlayerState | null>,
  ) {
    this.tick = tick;
    this.playerStates = playerStates;

    this.eventsByType = new Map();
    for (const event of events) {
      if (!this.eventsByType.has(event.getType())) {
        this.eventsByType.set(event.getType(), []);
      }
      this.eventsByType.get(event.getType())!.push(event);
    }

    this.npcs = new Map();

    events
      .filter(
        (event) =>
          event.getType() === Event.Type.NPC_SPAWN ||
          event.getType() === Event.Type.NPC_UPDATE,
      )
      .forEach((event) => {
        const npc = event.getNpc()!;

        this.npcs.set(npc.getRoomId(), {
          id: npc.getId(),
          x: event.getXCoord(),
          y: event.getYCoord(),
          hitpoints: SkillLevel.fromRaw(npc.getHitpoints()),
          attack: null,
        });
      });

    this.eventsByType.get(Event.Type.NPC_ATTACK)?.forEach((event) => {
      const roomId = event.getNpc()?.getRoomId();
      if (!roomId) {
        return;
      }

      const state = this.npcs.get(roomId);
      const attack = event.getNpcAttack();

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
   * Sets the tick whose state is represented, updating all events accordingly.
   * @param tick The new tick.
   */
  public setTick(tick: number): void {
    const offset = tick - this.tick;

    this.tick = tick;
    for (const [_, events] of this.eventsByType) {
      for (const event of events) {
        offsetEventTick(event, offset);
      }
    }
  }

  /**
   * @returns All events recorded on this tick.
   */
  public getEvents(): Event[] {
    const events: Event[] = [];
    for (const evts of this.eventsByType.values()) {
      events.push(...evts);
    }
    return events;
  }

  /**
   * Retrieves all events of the given type recorded on this tick.
   * @param type The type of events to retrieve.
   * @returns The events of the given type.
   */
  public getEventsByType(type: EventType): Event[] {
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
      this.getEvents().map((e) => e.clone()),
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
          .getEvents()
          .filter((e) => e.getNpc()?.getRoomId() === roomId);
        this.addEvents(npcEvents);
        // There is no need to resync when NPC state changes.
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

    const updateEvent = this.eventsByType
      .get(Event.Type.PLAYER_UPDATE)
      ?.find((e) => e.getPlayer()?.getName() === player);
    if (!updateEvent) {
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

    updateEvent.getPlayer()!.setEquipmentDeltasList(newDeltas);
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
      .getEvents()
      .filter((event) => GRAPHICS_EVENT_TYPES.has(event.getType()));
    if (events.length > 0) {
      this.addEvents(events);
    }
  }

  private overridePlayerState(player: string, other: TickState): void {
    for (const type of PLAYER_TICK_STATE_TYPES) {
      const events = this.eventsByType.get(type);
      if (events !== undefined) {
        this.eventsByType.set(
          type,
          events.filter((e) => e.getPlayer()?.getName() !== player),
        );
      }
    }

    this.playerStates.set(player, { ...other.getPlayerState(player)! });

    const playerEvents = other
      .getEvents()
      .filter(
        (e) =>
          PLAYER_TICK_STATE_TYPES.has(e.getType()) &&
          e.getPlayer()?.getName() === player,
      );
    this.addEvents(playerEvents);
  }

  /**
   * Removes and returns all events of the given types from this tick state.
   * @param types Event types to extract.
   * @returns The extracted events.
   */
  public extractEvents(types: ReadonlySet<EventType>): Event[] {
    const extracted: Event[] = [];
    for (const type of types) {
      const events = this.eventsByType.get(type);
      if (events !== undefined) {
        extracted.push(...events);
        this.eventsByType.delete(type);
      }
    }
    return extracted;
  }

  public addEvents(events: Event[]): void {
    for (const event of events) {
      if (!this.eventsByType.has(event.getType())) {
        this.eventsByType.set(event.getType(), []);
      }
      this.eventsByType.get(event.getType())!.push(event);
    }
  }
}
