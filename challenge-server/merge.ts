import {
  ChallengeType,
  DataSource,
  EquipmentSlot,
  ItemDelta,
  RawItemDelta,
  SkillLevel,
  Stage,
  StageStatus,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import { ClientEvents } from './client-events';
import logger from './log';

export type ChallengeInfo = {
  uuid: string;
  type: ChallengeType;
  party: string[];
};

type MergeClients = {
  base: ClientEvents;
  complete: ClientEvents[];
  partial: ClientEvents[];
};

export type MergeResult = {
  events: MergedEvents;
  mergedClients: ClientEvents[];
  unmergedClients: ClientEvents[];
};

export class Merger {
  private readonly stage: Stage;
  private readonly clients: ClientEvents[];

  public constructor(stage: Stage, clients: ClientEvents[]) {
    this.stage = stage;
    this.clients = clients.toSorted(
      (a, b) => b.getFinalTick() - a.getFinalTick(),
    );
  }

  public merge(): MergeResult | null {
    if (this.clients.length === 0) {
      logger.warn('No clients to merge');
      return null;
    }

    logger.info(
      `Merging events for stage ${this.stage} from ${this.clients.length} clients`,
    );

    for (const clientEvents of this.clients) {
      logger.debug(
        '    %s | ticks: %d accurate: %s',
        clientEvents,
        clientEvents.getFinalTick(),
        clientEvents.isAccurate(),
      );
    }

    const mergedClients: ClientEvents[] = [];
    const unmergedClients: ClientEvents[] = [];

    const clients = this.classifyClients();
    mergedClients.push(clients.base);

    if (!clients.base.isAccurate()) {
      const ok = clients.base.checkForConsistency();
      if (!ok) {
        logger.warn('Base client has likely lost ticks');
      }
    }

    const merged = new MergedEvents(clients.base);

    logger.debug(
      `Merging events from ${clients.complete.length} complete clients`,
    );
    for (const client of clients.complete) {
      if (merged.mergeEvents(client)) {
        mergedClients.push(client);
      } else {
        unmergedClients.push(client);
      }
    }

    logger.debug(
      `Merging events from ${clients.partial.length} partial clients`,
    );
    for (const client of clients.partial) {
      if (merged.mergeEvents(client)) {
        mergedClients.push(client);
      } else {
        unmergedClients.push(client);
      }
    }

    logger.info(
      `Successfully merged events from ${mergedClients.length} clients`,
    );
    if (unmergedClients.length > 0) {
      logger.warn(`${unmergedClients.length} clients could not be merged`);
    }

    return { events: merged, mergedClients, unmergedClients };
  }

  /**
   * Splits clients into three categories: a single base client, clients with
   * complete tick data, and clients with partial tick data.
   */
  private classifyClients(): MergeClients {
    let accurateClients = this.clients.filter((client) => client.isAccurate());

    let stageTicks = 0;
    let base: ClientEvents;

    if (accurateClients.length > 0) {
      base = accurateClients[0];
      stageTicks = base.getFinalTick();
      logger.debug(`Using ${stageTicks} ticks from accurate client ${base}`);

      for (const client of accurateClients) {
        if (client.getFinalTick() !== stageTicks) {
          logger.error(
            `${client} claims to be accurate but differs in tick count ` +
              `(expected: ${stageTicks}, actual: ${client.getFinalTick()})`,
          );

          client.setAccurate(false);
          accurateClients = accurateClients.filter(
            (c) => c.getId() !== client.getId(),
          );
        }
      }
    } else {
      // `this.clients` is sorted by decreasing tick count. Use the client with
      // the most recorded ticks as the base client, but prioritize clients
      // which have reported in-game tick counts.
      const ref = this.clients.find(
        (c) => c.getServerTicks()?.precise === true,
      );
      if (ref !== undefined) {
        base = ref;
        stageTicks = ref.getServerTicks()!.count;
      } else {
        // If there is no client with a precise in-game tick count, use any
        // which has an imprecise count.
        const ref = this.clients.find((c) => c.getServerTicks() !== null);
        if (ref !== undefined) {
          base = ref;
          stageTicks = base.getServerTicks()!.count;
        } else {
          base = this.clients[0];
          stageTicks = base.getFinalTick();
          logger.debug(
            `Assuming ${stageTicks} ticks from most active client ${base}`,
          );
        }
      }
    }

    const complete = [];
    const partial = [];

    for (const client of this.clients) {
      if (client.getId() === base.getId()) {
        continue;
      }

      if (client.getFinalTick() === stageTicks) {
        complete.push(client);
      } else {
        partial.push(client);
      }
    }

    return { base, complete, partial };
  }
}

type NpcState = {
  x: number;
  y: number;
  hitpoints: number;
};

type EquippedItem = {
  id: number;
  quantity: number;
};

export type PlayerState = {
  source: DataSource;
  username: string;
  x: number;
  y: number;
  isDead: boolean;
  equipment: {
    [slot in EquipmentSlot]: EquippedItem | null;
  };
};

export class TickState {
  private tick: number;
  private eventsByType: Map<number, Event[]>;
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
    const events = [];
    for (const evts of this.eventsByType.values()) {
      events.push(...evts);
    }
    return events;
  }

  public getPlayerState(player: string): PlayerState | null {
    return this.playerStates[player] ?? null;
  }

  /**
   * Creates a deep copy of this tick state and its events.
   * @returns Cloned tick state.
   */
  public clone(): TickState {
    const playerStates: Record<string, PlayerState | null> = {};
    for (const player in this.playerStates) {
      if (this.playerStates[player] !== null) {
        const current = this.playerStates[player]!;
        playerStates[player] = { ...current };
      } else {
        playerStates[player] = null;
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
  public resynchronize(tickStates: Array<TickState | null>): void {
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
    tickStates: Array<TickState | null>,
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

    for (let slot = EquipmentSlot.HEAD; slot <= EquipmentSlot.RING; slot++) {
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

export class MergedEvents {
  private ticks: Array<TickState | null>;
  private readonly status: StageStatus;
  private accurate: boolean;

  constructor(base: ClientEvents) {
    const tickCount =
      base.getServerTicks() !== null
        ? base.getServerTicks()!.count
        : base.getFinalTick();

    this.status = base.getStatus();
    this.accurate = base.isAccurate();
    this.ticks = Array(tickCount + 1).fill(null);
    this.initializeBaseTicks(base);
  }

  public events(): EventIterator {
    return new EventIterator(this.ticks);
  }

  [Symbol.iterator](): EventIterator {
    return this.events();
  }

  public isAccurate(): boolean {
    return this.accurate;
  }

  public getStatus(): StageStatus {
    return this.status;
  }

  public getLastTick(): number {
    return this.ticks.length - 1;
  }

  public getMissingTickCount(): number {
    return this.ticks.filter((tick) => tick === null).length;
  }

  public eventsForTick(tick: number): Event[] {
    return this.ticks[tick]?.getEvents() ?? [];
  }

  public mergeEvents(client: ClientEvents): boolean {
    let success = false;

    if (this.accurate) {
      if (client.isAccurate()) {
        success = this.mergeAccurateEvents(client);
      } else {
        logger.warn(
          'Merging of inaccurate into accurate clients is not yet implemented',
        );
      }
    } else {
      logger.warn('Merging of two inaccurate clients is not yet implemented');
    }

    if (success) {
      this.ticks.forEach((tick) => tick?.resynchronize(this.ticks));
    }

    return success;
  }

  private initializeBaseTicks(base: ClientEvents): void {
    if (base.isAccurate()) {
      logger.debug('Base client is accurate; using all events');
      for (let i = 0; i <= base.getFinalTick(); i++) {
        this.ticks[i] = base.getTickState(i)?.clone() ?? null;
      }
    } else if (base.getServerTicks() !== null) {
      // If the base client is not accurate but has reported an in-game tick
      // count, it has completed the stage, so it is initially assumed that its
      // events are offset from the end of the stage.
      const offset = base.getServerTicks()!.count - base.getFinalTick();
      logger.debug(
        'Base client is not accurate but has in-game tick count; ' +
          `assuming events from end of stage with a ${offset} tick offset`,
      );
      for (let i = 0; i <= base.getFinalTick(); i++) {
        const state = base.getTickState(i);
        if (state !== null) {
          const tickState = state.clone();
          tickState.setTick(i + offset);
          this.ticks[i + offset] = tickState;
        }
      }
    } else {
      logger.debug(
        'Base client is not accurate and has no in-game tick count; ' +
          'assuming events from start',
      );
      for (let i = 0; i <= base.getFinalTick(); i++) {
        this.ticks[i] = base.getTickState(i)?.clone() ?? null;
      }
    }
  }

  private mergeAccurateEvents(client: ClientEvents): boolean {
    for (let tick = this.ticks.length - 1; tick >= 0; tick--) {
      const stateToMerge = client.getTickState(tick);
      if (stateToMerge === null) {
        continue;
      }

      const existingState = this.ticks[tick];
      if (existingState !== null) {
        if (!existingState.merge(stateToMerge)) {
          logger.error(
            `Failed to merge events at tick ${tick} from ${client} into base`,
          );
          return false;
        }
      } else {
        this.ticks[tick] = stateToMerge.clone();
      }
    }

    return true;
  }
}

class EventIterator implements Iterator<Event, Event | null> {
  private readonly ticks: Array<TickState | null>;
  private tick: number;
  private eventIndex: number;

  constructor(ticks: Array<TickState | null>) {
    this.ticks = ticks;
    this.tick = 0;
    this.eventIndex = 0;
  }

  public next(): IteratorResult<Event, Event | null> {
    for (; this.tick < this.ticks.length; this.tick++) {
      if (this.ticks[this.tick] === null) {
        this.eventIndex = 0;
        continue;
      }

      const tickEvents = this.ticks[this.tick]!.getEvents();
      while (this.eventIndex < tickEvents.length) {
        return {
          done: false,
          value: tickEvents[this.eventIndex++],
        };
      }

      this.eventIndex = 0;
    }

    return { done: true, value: null };
  }
}

function offsetEventTick(event: Event, offset: number): void {
  event.setTick(event.getTick() + offset);

  switch (event.getType()) {
    case Event.Type.PLAYER_UPDATE: {
      const player = event.getPlayer()!;
      player.setOffCooldownTick(player.getOffCooldownTick() + offset);
      break;
    }
  }
}
