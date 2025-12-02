import {
  DataSource,
  EquipmentSlot,
  ItemDelta,
  RawItemDelta,
  SkillLevel,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

type EventType = Event.TypeMap[keyof Event.TypeMap];

function offsetEventTick(event: Event, offset: number): void {
  event.setTick(event.getTick() + offset);

  switch (event.getType()) {
    case Event.Type.PLAYER_UPDATE: {
      const player = event.getPlayer()!;
      player.setOffCooldownTick(player.getOffCooldownTick() + offset);
      break;
    }

    case Event.Type.TOB_XARPUS_EXHUMED: {
      const xarpusExhumed = event.getXarpusExhumed()!;
      xarpusExhumed.setSpawnTick(xarpusExhumed.getSpawnTick() + offset);
      break;
    }

    case Event.Type.TOB_VERZIK_ATTACK_STYLE:
    case Event.Type.TOB_VERZIK_BOUNCE:
    case Event.Type.TOB_VERZIK_DAWN:
    case Event.Type.MOKHAIOTL_ATTACK_STYLE:
      // TODO(frolv): These events all have fields which reference previous
      // ticks. Instead of this function being given a single offset, it should
      // be called with the complete mapping of old ticks to new ticks.
      break;
  }
}

export type NpcState = {
  id: number;
  x: number;
  y: number;
  hitpoints: number;
};

export type EquippedItem = {
  id: number;
  quantity: number;
};

export type PlayerState = {
  source: DataSource;
  username: string;
  x: number;
  y: number;
  isDead: boolean;
  equipment: Record<EquipmentSlot, EquippedItem | null>;
};

export class TickState {
  private tick: number;
  private eventsByType: Map<EventType, Event[]>;
  private npcs: Map<number, NpcState>;
  private playerStates: Record<string, PlayerState | null>;
  private requiresResync: boolean;

  public constructor(
    tick: number,
    events: Event[],
    playerStates: Record<string, PlayerState | null>,
  ) {
    this.tick = tick;
    this.playerStates = playerStates;
    this.requiresResync = false;

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
          hitpoints: SkillLevel.fromRaw(npc.getHitpoints()).getCurrent(),
        });
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
  public getPlayerStates(): Readonly<Record<string, PlayerState | null>> {
    return this.playerStates;
  }

  /**
   * Retrieves the state of the player with the given username on this tick.
   *
   * @param player The username of the player to retrieve.
   * @returns The player state, or `null` if the player is not present.
   */
  public getPlayerState(player: string): Readonly<PlayerState | null> {
    return this.playerStates[player] ?? null;
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
    const playerStates = structuredClone(this.playerStates);
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
    if (this.tick !== other.tick) {
      return false;
    }

    for (const player in other.playerStates) {
      const otherState = other.playerStates[player];
      if (otherState === null) {
        continue;
      }

      const currentState = this.playerStates[player];
      const shouldUpdate =
        !currentState ||
        (currentState.source === DataSource.SECONDARY &&
          otherState.source === DataSource.PRIMARY);

      if (shouldUpdate) {
        this.overridePlayerState(player, other);
        this.requiresResync = true;
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

    this.mergeRegularEvents(other);

    return true;
  }

  /**
   * Updates the events representing this tick state to reflect any changes in
   * the overall stage state following a merge.
   * @param tickStates Updated tick states for the entire stage.
   */
  public resynchronize(tickStates: (TickState | null)[]): void {
    if (!this.requiresResync) {
      return;
    }

    for (const player in this.playerStates) {
      this.resynchronizePlayer(player, tickStates);
    }

    this.requiresResync = false;
  }

  private resynchronizePlayer(
    player: string,
    tickStates: (TickState | null)[],
  ): void {
    const state = this.playerStates[player];
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
        if (!previous || current.id !== previous.id) {
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
   * Copies events that do not require special processing from `other` into this
   * tick state, if they do not already exist.
   * @param other Tick state to merge.
   */
  private mergeRegularEvents(other: TickState): void {
    const excludedTypes: number[] = [
      Event.Type.PLAYER_ATTACK,
      Event.Type.PLAYER_DEATH,
      Event.Type.PLAYER_UPDATE,
      Event.Type.NPC_ATTACK,
      Event.Type.NPC_DEATH,
      Event.Type.NPC_UPDATE,
      Event.Type.NPC_SPAWN,
    ];
    const missingEvents = other
      .getEvents()
      .filter(
        (event) =>
          !excludedTypes.includes(event.getType()) &&
          !this.eventsByType.has(event.getType()),
      );
    this.addEvents(missingEvents);
  }

  private overridePlayerState(player: string, other: TickState): void {
    for (const [type, events] of this.eventsByType) {
      const withoutPlayer = events.filter(
        (e) => e.getPlayer()?.getName() !== player,
      );
      this.eventsByType.set(type, withoutPlayer);
    }

    this.playerStates[player] = { ...other.playerStates[player]! };
    const playerEvents = other
      .getEvents()
      .filter((e) => e.getPlayer()?.getName() === player);
    this.addEvents(playerEvents);
  }

  private addEvents(events: Event[]): void {
    for (const event of events) {
      if (!this.eventsByType.has(event.getType())) {
        this.eventsByType.set(event.getType(), []);
      }
      this.eventsByType.get(event.getType())!.push(event);
    }
  }
}
