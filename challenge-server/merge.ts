import {
  ChallengeType,
  DataSource,
  EquipmentSlot,
  ItemDelta,
  Npc,
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
  referenceTicks: number;
  base: ClientEvents;
  matching: ClientEvents[];
  mismatched: ClientEvents[];
};

export type MergeResult = {
  events: MergedEvents;
  mergedClients: ClientEvents[];
  unmergedClients: ClientEvents[];
};

/**
 * From a list of clients, finds the modal tick count. If there is a tie for
 * the mode, the highest tick count is chosen.
 * @param clients The clients to find the consensus tick count from.
 * @param key The key to get the tick count from.
 * @returns The consensus tick count, or null if clients is empty.
 */
function getConsensusTicks(
  clients: ClientEvents[],
  key: (c: ClientEvents) => number,
): number {
  if (clients.length === 0) {
    throw new Error('No clients from which to get consensus tick count');
  }

  const counts = new Map<number, number>();
  for (const client of clients) {
    const k = key(client);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const maxCount = Math.max(...counts.values());
  const modes = [...counts.keys()].filter((k) => counts.get(k) === maxCount);

  return Math.max(...modes);
}

/**
 * Splits clients into three categories: a single reference client, clients with
 * complete tick data, and clients with partial tick data.
 *
 * Preconditions: `clients` is nonempty.
 *
 * @param clients Nonempty list of clients to classify.
 * @returns The classified clients and a reference tick count for the stage.
 */
export function classifyClients(clients: ClientEvents[]): MergeClients {
  let baseClient: ClientEvents | null = null;
  let referenceTicks = 0;

  // 1. Prioritize accurate clients.
  const accurateClients = clients.filter((c) => c.isAccurate());
  if (accurateClients.length > 0) {
    referenceTicks = getConsensusTicks(accurateClients, (c) =>
      c.getFinalTick(),
    );

    const candidates = accurateClients.filter(
      (c) => c.getFinalTick() === referenceTicks,
    );

    // Tie-break by lowest client ID.
    candidates.sort((a, b) => a.getId() - b.getId());
    baseClient = candidates[0];

    logger.debug(
      `Using ${referenceTicks} ticks from accurate consensus ${baseClient.toString()}`,
    );
  }

  // 2. If no accurate client exists, pick a precise client with the highest
  //    recorded tick count.
  if (baseClient === null) {
    const preciseClients = clients.filter(
      (c) => c.getServerTicks()?.precise === true,
    );
    if (preciseClients.length > 0) {
      preciseClients.sort(
        (a, b) => b.getFinalTick() - a.getFinalTick() || a.getId() - b.getId(),
      );
      baseClient = preciseClients[0];
      referenceTicks = baseClient.getServerTicks()!.count;
      logger.debug(
        `Using ${referenceTicks} ticks from precise client ${baseClient.toString()}`,
      );
    }
  }

  // 3. If no precise client exists, pick a client with an imprecise server tick
  //    count, again with the highest recorded tick count.
  if (baseClient === null) {
    const impreciseClients = clients.filter(
      (c) => c.getServerTicks()?.precise === false,
    );
    if (impreciseClients.length > 0) {
      impreciseClients.sort(
        (a, b) => b.getFinalTick() - a.getFinalTick() || a.getId() - b.getId(),
      );
      baseClient = impreciseClients[0];
      referenceTicks = baseClient.getServerTicks()!.count;
      logger.debug(
        `Using ${referenceTicks} from imprecise client ${baseClient.toString()}`,
      );
    }
  }

  // 4. Finally, if no client has a server tick count, use the one with the
  //    highest recorded tick count.
  if (baseClient === null) {
    const sortedClients = clients.toSorted(
      (a, b) => b.getFinalTick() - a.getFinalTick() || a.getId() - b.getId(),
    );
    baseClient = sortedClients[0];
    referenceTicks = baseClient.getFinalTick();
    logger.debug(
      `Assuming ${referenceTicks} from recorded ticks on ${baseClient.toString()}`,
    );
  }

  if (baseClient === null) {
    // This should not be reachable if `clients` is non-empty.
    throw new Error('Could not determine a reference client');
  }

  const matching: ClientEvents[] = [];
  const mismatched: ClientEvents[] = [];

  for (const client of clients) {
    if (client.getId() === baseClient.getId()) {
      continue;
    }

    const isMatching =
      baseClient.isAccurate() &&
      client.isAccurate() &&
      client.getFinalTick() === referenceTicks;

    if (isMatching) {
      matching.push(client);
    } else {
      mismatched.push(client);
    }
  }

  return { base: baseClient, matching, mismatched, referenceTicks };
}

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

    const clients = this.classifyAndUpdateClients();
    mergedClients.push(clients.base);

    if (!clients.base.isAccurate()) {
      const ok = clients.base.checkForConsistency();
      if (!ok) {
        logger.warn('Base client has likely lost ticks');
      }
    }

    const merged = new MergedEvents(clients.base);

    logger.debug(
      `Merging events from ${clients.matching.length} complete clients`,
    );
    for (const client of clients.matching) {
      if (merged.mergeEventsFrom(client)) {
        mergedClients.push(client);
      } else {
        unmergedClients.push(client);
      }
    }

    logger.debug(
      `Merging events from ${clients.mismatched.length} partial clients`,
    );
    for (const client of clients.mismatched) {
      if (merged.mergeEventsFrom(client)) {
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

    merged.postprocess(this.stage);

    return { events: merged, mergedClients, unmergedClients };
  }

  private classifyAndUpdateClients(): MergeClients {
    const accurateClients = this.clients.filter((c) => c.isAccurate());

    if (accurateClients.length > 0) {
      const counts = new Map<number, number>();
      let maxCount = 0;
      for (const client of accurateClients) {
        const k = client.getFinalTick();
        const count = (counts.get(k) ?? 0) + 1;
        counts.set(k, count);
        if (count > maxCount) {
          maxCount = count;
        }
      }

      const modes = [...counts.keys()].filter(
        (k) => counts.get(k) === maxCount,
      );

      if (modes.length > 1) {
        logger.warn(
          `Multiple accurate tick modes found: ${modes.join(', ')}. ` +
            `This indicates bad input data. Demoting all accurate clients.`,
          // TODO(frolv): Flag this merge for review.
        );
        for (const client of accurateClients) {
          client.setAccurate(false);
        }
      } else {
        // Single mode. Demote any "accurate" clients that don't match.
        const modalTicks = modes[0];
        for (const client of accurateClients) {
          if (client.isAccurate() && client.getFinalTick() !== modalTicks) {
            logger.warn(
              `${client.toString()} claims to be accurate but differs from the modal tick count ` +
                `(expected: ${modalTicks}, actual: ${client.getFinalTick()})`,
            );
            client.setAccurate(false);
          }
        }
      }
    }

    return classifyClients(this.clients);
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
  equipment: Record<EquipmentSlot, EquippedItem | null>;
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

  public getPlayerStates(): Record<string, PlayerState | null> {
    return this.playerStates;
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
        const current = this.playerStates[player];
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

export class MergedEvents {
  private ticks: (TickState | null)[];
  private readonly status: StageStatus;
  private accurate: boolean;

  constructor(base: ClientEvents) {
    const tickCount =
      base.getServerTicks() !== null
        ? base.getServerTicks()!.count
        : base.getFinalTick();

    this.status = base.getStatus();
    this.accurate = base.isAccurate();
    this.ticks = Array<TickState | null>(tickCount + 1).fill(null);
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

  /**
   * Merges events from `client` into this merged event set.
   * @param client Client to merge events from.
   * @returns Whether the merge was successful.
   */
  public mergeEventsFrom(client: ClientEvents): boolean {
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

  /**
   * Applies post-merge corrections to the event set.
   * @param stage Stage that the events are being merged for.
   */
  public postprocess(stage: Stage): void {
    if (stage === Stage.TOB_MAIDEN) {
      this.correctOffsetMaidenSpawn();
    }
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
            `Failed to merge events at tick ${tick} from ${client.toString()} into base`,
          );
          return false;
        }
      } else {
        this.ticks[tick] = stateToMerge.clone();
      }
    }

    return true;
  }

  private correctOffsetMaidenSpawn(): void {
    // On 2025-02-18, a RuneScape update limited clients to receiving events
    // from only actors that were rendered, rather than all actors in an
    // instance. This is likely to manifest in many ways, but the first known
    // issue is that Maiden only appears two ticks into the room from an
    // entering player's perspective.
    //
    // Correct this by moving Maiden's spawn event to the start of the stage and
    // inserting fake NPC update events during the missing ticks. Fortunately,
    // Maiden can't be attacked during this time, so we can just set her HP to
    // 100%.
    let firstMaidenEvent = null;
    for (const event of this) {
      if (event.getType() === Event.Type.NPC_SPAWN) {
        const npc = event.getNpc()!;
        if (Npc.isMaiden(npc.getId())) {
          firstMaidenEvent = event;
          break;
        }
      }
    }

    if (firstMaidenEvent === null) {
      return;
    }

    const tick = firstMaidenEvent.getTick();
    const maidenNpc = firstMaidenEvent.getNpc()!;
    const hitpoints = SkillLevel.fromRaw(maidenNpc.getHitpoints());

    // Confirm that Maiden is at full HP to try to avoid the case where the
    // client has lost ticks and recorded tick 2 isn't actually the second tick.
    if (tick !== 2 || hitpoints.getCurrent() !== hitpoints.getBase()) {
      return;
    }

    const tickState = this.ticks[tick];
    if (tickState === null) {
      return;
    }

    const events = tickState.getEvents();
    const maidenSpawn = events.find(
      (e) => e.getType() === Event.Type.NPC_SPAWN,
    );
    if (maidenSpawn === undefined) {
      return;
    }

    // On the affected tick, change the NPC spawn event to an NPC update.
    const updateEvent = maidenSpawn.clone();
    updateEvent.setType(Event.Type.NPC_UPDATE);

    const otherEvents = events.filter((e) => e !== maidenSpawn);
    this.ticks[tick] = new TickState(
      tick,
      [...otherEvents, updateEvent],
      tickState.getPlayerStates(),
    );

    maidenSpawn.setTick(0);

    // Add the appropriate NPC events for the initial ticks of the stage.
    for (let i = 0; i < tick; i++) {
      const state = this.ticks[i];
      if (state === null) {
        continue;
      }

      let newEvent: Event;
      if (i === 0) {
        newEvent = maidenSpawn;
      } else {
        newEvent = updateEvent.clone();
        newEvent.setTick(i);
      }

      this.ticks[i] = new TickState(
        i,
        [...state.getEvents(), newEvent],
        state.getPlayerStates(),
      );
    }
  }
}

class EventIterator implements Iterator<Event, Event | null> {
  private readonly ticks: (TickState | null)[];
  private tick: number;
  private eventIndex: number;

  constructor(ticks: (TickState | null)[]) {
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
