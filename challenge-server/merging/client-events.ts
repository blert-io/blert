import {
  applyItemDeltas,
  ClientStageStream,
  DataSource,
  EquipmentSlot,
  Maze,
  PrayerBook,
  PrayerSet,
  SkillLevel,
  Stage,
  StageStatus,
  StageStreamType,
} from '@blert/common';
import { ChallengeEvents } from '@blert/common/generated/challenge_storage_pb';
import { Event } from '@blert/common/generated/event_pb';

import {
  consistencyCheckerForStage,
  ConsistencyIssue,
  ConsistencyIssueType,
  MovementConsistencyChecker,
} from './client-consistency';
import { ChallengeInfo } from './context';
import logger from '../log';
import { DERIVED_EVENT_TYPES } from './event';
import { buildGraphicsStates } from './graphics';
import { recordGameCorrection } from '../metrics';
import {
  buildNpcStates,
  PlayerState,
  PlayerStats,
  TickState,
  TickStateArray,
  WithProvenance,
} from './tick-state';
import { chebyshev } from './world';

const EMPTY_EQUIPMENT: PlayerState['equipment'] = {
  [EquipmentSlot.HEAD]: null,
  [EquipmentSlot.CAPE]: null,
  [EquipmentSlot.AMULET]: null,
  [EquipmentSlot.AMMO]: null,
  [EquipmentSlot.WEAPON]: null,
  [EquipmentSlot.TORSO]: null,
  [EquipmentSlot.SHIELD]: null,
  [EquipmentSlot.LEGS]: null,
  [EquipmentSlot.GLOVES]: null,
  [EquipmentSlot.BOOTS]: null,
  [EquipmentSlot.RING]: null,
  [EquipmentSlot.QUIVER]: null,
};

export const enum ClientAnomaly {
  MULTIPLE_PRIMARY_PLAYERS = 'MULTIPLE_PRIMARY_PLAYERS',
  MISSING_STAGE_METADATA = 'MISSING_STAGE_METADATA',
  CONSISTENCY_ISSUES = 'CONSISTENCY_ISSUES',
  EVENTS_BEYOND_RECORDED_TICKS = 'EVENTS_BEYOND_RECORDED_TICKS',
  GAME_CORRECTION_APPLIED = 'GAME_CORRECTION_APPLIED',
  BAD_DATA = 'BAD_DATA',
}

export type ClientGameCorrection = {
  type: 'osrs_238_nylocas';
  applied: {
    action: 'rewrite_spawn' | 'rewrite_death' | 'drop_death';
    tick: number;
    roomId: number;
  }[];
};

export type ServerTicks = {
  count: number;
  precise: boolean;
};

/** Connection metadata reported by a client alongside its stage stream. */
export type ClientMetadata = {
  userId: number;
  pluginVersion: string;
  runeLiteVersion: string;
};

/**
 * Stage-scoped data extracted from a client's raw events.
 *
 * This data does not fit a per-client, per-tick merge model and is handled
 * separately at the end of the client merge process.
 */
export type StageData = {
  sotePivots: SotePivotEvent[];
};

type SotePivotEvent = {
  maze: Maze;
  overworld: { x: number; y: number }[];
  underworld: { x: number; y: number }[];
};

type StageInfo = {
  stage: Stage;
  status: StageStatus;
  accurate: boolean;
  recordedTicks: number;
  serverTicks: ServerTicks | null;
};

/**
 * OSRS cache version 238 (2026-05-06) introduced some regressions into
 * RuneLite's NPC tracking, where RuneLite's NPC map sometimes drops an NPC
 * from its local world state. Since RuneLite emits spawn and respawn events
 * based on deltas in its local state, this results in spurious events being
 * fired, which the plugin then picks up.
 *
 * A plugin-side mitigation for this is not viable as it would require holding
 * and delaying events. Instead, we correct the events on ingestion here. This
 * is deliberately scoped to only Nylocas, as that is so far the only stage
 * where issues have been observed.
 *
 * Specifically, this looks for intermediate death/spawn pairs for a specific
 * room ID within its full lifecycle, and applies the following corrections:
 *
 * - Rewrites the spurious spawn event as an `NPC_UPDATE` as the two events
 *   carry the same information, differing only by whether it was the first
 *   time the NPC was seen.
 *
 * - Deletes the spurious death event, leaving a gap in the NPC's timeline, or:
 *
 * - If possible, rewrites the death event as an `NPC_UPDATE` at an interpolated
 *   midpoint tile. This requires three conditions:
 *
 *   1. The death and respawn must occur on consecutive ticks.
 *   2. The implied movement between the death and respawn must be unambiguous.
 *      Nylos move 1 tile per tick, so this requires a straight line two tile
 *      move in any direction.
 *   3. No lag (impossible player movement) is detected at the boundary, since a
 *      stall can leave the recorded tick numbers consecutive while losing real
 *      ticks, which would invalidate the midpoint.
 *
 * @param events Client events for a Nylocas stage, sorted by tick.
 * @param context Identifying information for logging.
 * @returns The corrected event list.
 */
function tryApplyOsrs238NylocasCorrection(
  events: Event[],
  context: { challengeUuid: string; clientId: number },
): { events: Event[]; correction: ClientGameCorrection | null } {
  const lifecycleById = new Map<number, Event[]>();
  // Ticks where a player moved more than 2 tiles, signalling lost ticks.
  const laggedTicks = new Set<number>();
  const lastPlayer = new Map<string, { tick: number; x: number; y: number }>();

  for (const event of events) {
    const type = event.getType();
    if (type === Event.Type.NPC_SPAWN || type === Event.Type.NPC_DEATH) {
      const roomId = event.getNpc()!.getRoomId();
      const list = lifecycleById.get(roomId);
      if (list === undefined) {
        lifecycleById.set(roomId, [event]);
      } else {
        list.push(event);
      }
    } else if (type === Event.Type.PLAYER_UPDATE) {
      const name = event.getPlayer()!.getName();
      const tick = event.getTick();
      const position = { x: event.getXCoord(), y: event.getYCoord() };
      const last = lastPlayer.get(name);
      if (
        last !== undefined &&
        chebyshev(position, last) > 2 * (tick - last.tick)
      ) {
        laggedTicks.add(tick);
      }
      lastPlayer.set(name, { tick, ...position });
    }
  }

  // Identify corrections without mutating, so the spawn/death scan below sees
  // original event types.
  const respawns = new Set<Event>();
  const interpolatedDeaths: { event: Event; x: number; y: number }[] = [];
  const droppedDeaths = new Set<Event>();

  for (const lifecycle of lifecycleById.values()) {
    for (let i = 0; i < lifecycle.length; i++) {
      const death = lifecycle[i];
      if (death.getType() !== Event.Type.NPC_DEATH) {
        continue;
      }
      const respawn = lifecycle
        .slice(i + 1)
        .find((e) => e.getType() === Event.Type.NPC_SPAWN);
      if (respawn === undefined) {
        // Terminal death.
        continue;
      }
      respawns.add(respawn);

      // A stalled death on tick t freezes at the t-1 tile, and the spurious
      // respawn carries the real t+1 tile. The intermediate (t) tile is only
      // unique when the two-tick move is a straight line of length 2.
      const dx = respawn.getXCoord() - death.getXCoord();
      const dy = respawn.getYCoord() - death.getYCoord();
      const consecutive = respawn.getTick() === death.getTick() + 1;
      const unambiguous =
        dx % 2 === 0 &&
        dy % 2 === 0 &&
        Math.abs(dx) <= 2 &&
        Math.abs(dy) <= 2 &&
        (dx !== 0 || dy !== 0);

      const lagFree =
        !laggedTicks.has(death.getTick()) &&
        !laggedTicks.has(respawn.getTick());
      if (consecutive && unambiguous && lagFree) {
        interpolatedDeaths.push({
          event: death,
          x: death.getXCoord() + dx / 2,
          y: death.getYCoord() + dy / 2,
        });
      } else {
        droppedDeaths.add(death);
      }
    }
  }

  if (respawns.size === 0) {
    return { events, correction: null };
  }

  const correction: ClientGameCorrection = {
    type: 'osrs_238_nylocas',
    applied: [],
  };

  for (const respawn of respawns) {
    respawn.setType(Event.Type.NPC_UPDATE);
    correction.applied.push({
      action: 'rewrite_spawn',
      tick: respawn.getTick(),
      roomId: respawn.getNpc()!.getRoomId(),
    });
  }

  for (const { event, x, y } of interpolatedDeaths) {
    event.setType(Event.Type.NPC_UPDATE);
    event.setXCoord(x);
    event.setYCoord(y);
    correction.applied.push({
      action: 'rewrite_death',
      tick: event.getTick(),
      roomId: event.getNpc()!.getRoomId(),
    });
  }

  for (const death of droppedDeaths) {
    correction.applied.push({
      action: 'drop_death',
      tick: death.getTick(),
      roomId: death.getNpc()!.getRoomId(),
    });
  }

  logger.warn('osrs_238_nylocas_correction', {
    challengeUuid: context.challengeUuid,
    clientId: context.clientId,
    respawnsRewritten: respawns.size,
    deathsInterpolated: interpolatedDeaths.length,
    deathsDropped: droppedDeaths.size,
    corrections: correction.applied,
  });
  recordGameCorrection('osrs238_nylocas');

  return {
    events:
      droppedDeaths.size === 0
        ? events
        : events.filter((e) => !droppedDeaths.has(e)),
    correction,
  };
}

export class ClientEvents {
  private readonly clientId: number;
  private readonly challenge: ChallengeInfo;
  private readonly stageInfo: Readonly<StageInfo>;
  private readonly tickState: TickState[];
  private readonly stageData: Readonly<StageData>;
  private readonly metadata: ClientMetadata | null;
  private readonly primaryPlayer: string | null;
  private readonly invalidTickCount: boolean;
  private readonly anomalies: Set<ClientAnomaly>;
  private readonly corrections: ClientGameCorrection[];
  private accurate: boolean;
  private consistencyIssues: ConsistencyIssue[];

  /**
   * Initializes challenge events for a client from its stage event stream.
   *
   * @param clientId ID of the client that recorded these events.
   * @param challenge The challenge to which the events belong.
   * @param stage The stage whose events are recorded.
   * @param streamEvents Raw stream of client events.
   * @returns Structured client events.
   */
  public static fromClientStream(
    clientId: number,
    challenge: ChallengeInfo,
    stage: Stage,
    streamEvents: ClientStageStream[],
  ): ClientEvents {
    const stageInfo: StageInfo = {
      stage,
      status: StageStatus.STARTED,
      accurate: false,
      recordedTicks: 0,
      serverTicks: null,
    };

    const events: Event[] = [];
    const anomalies = new Set<ClientAnomaly>();
    let metadata: ClientMetadata | null = null;
    let sawStageEnd = false;

    for (const stream of streamEvents) {
      if (stream.type === StageStreamType.CLIENT_METADATA) {
        metadata = {
          userId: stream.userId,
          pluginVersion: stream.pluginVersion,
          runeLiteVersion: stream.runeLiteVersion,
        };
      } else if (stream.type === StageStreamType.STAGE_END) {
        const update = stream.update;
        stageInfo.status = update.status;
        stageInfo.accurate = update.accurate;
        stageInfo.recordedTicks = update.recordedTicks;
        stageInfo.serverTicks = update.serverTicks;
        sawStageEnd = true;
      } else if (stream.type === StageStreamType.STAGE_EVENTS) {
        try {
          const message = ChallengeEvents.deserializeBinary(stream.events);
          events.push(...message.getEventsList());
        } catch (e: unknown) {
          logger.error('client_events_deserialization_failed', {
            challengeUuid: challenge.uuid,
            clientId,
            stage,
            error: e instanceof Error ? e.message : String(e),
          });
          anomalies.add(ClientAnomaly.BAD_DATA);
        }
      }
    }

    if (!sawStageEnd) {
      anomalies.add(ClientAnomaly.MISSING_STAGE_METADATA);
      logger.warn('client_missing_stage_metadata', {
        challengeUuid: challenge.uuid,
        clientId,
        stage,
      });
    }

    return ClientEvents.fromRawEvents(
      clientId,
      challenge,
      stageInfo,
      events,
      metadata,
      anomalies,
    );
  }

  /**
   * Initializes challenge events for a client from a list of raw events.
   *
   * @param clientId ID of the client that recorded these events.
   * @param challenge The challenge to which the events belong.
   * @param stageInfo Information about the stage of the challenge.
   * @param rawEvents Raw list of stage events.
   * @param metadata Connection metadata reported by the client.
   * @param anomalies Optional set of anomalies detected in the client's events.
   * @returns Structured client events.
   */
  public static fromRawEvents(
    clientId: number,
    challenge: ChallengeInfo,
    stageInfo: StageInfo,
    rawEvents: Event[],
    metadata: ClientMetadata | null = null,
    anomaliesParam?: Set<ClientAnomaly>,
  ): ClientEvents {
    const anomalies = anomaliesParam ?? new Set<ClientAnomaly>();
    const corrections: ClientGameCorrection[] = [];

    const sortedEvents = rawEvents.toSorted(
      (a, b) => a.getTick() - b.getTick(),
    );

    let events = sortedEvents;
    if (stageInfo.stage === Stage.TOB_NYLOCAS) {
      const { events: correctedEvents, correction } =
        tryApplyOsrs238NylocasCorrection(sortedEvents, {
          challengeUuid: challenge.uuid,
          clientId,
        });
      events = correctedEvents;
      if (correction !== null) {
        corrections.push(correction);
        anomalies.add(ClientAnomaly.GAME_CORRECTION_APPLIED);
      }
    }

    if (stageInfo.recordedTicks === 0 && events.length > 0) {
      stageInfo.recordedTicks = events[events.length - 1].getTick();
    }

    const primaryPlayers = new Set<string>();

    const eventsByTick: Event[][] = Array.from(
      { length: stageInfo.recordedTicks + 1 },
      () => [],
    );

    let droppedEventCount = 0;
    let derivedEventCount = 0;
    const stageData: StageData = { sotePivots: [] };

    for (const event of events) {
      if (DERIVED_EVENT_TYPES.has(event.getType())) {
        derivedEventCount++;
        continue;
      }

      if (
        event.getType() === Event.Type.PLAYER_UPDATE &&
        event.getPlayer()!.getDataSource() === DataSource.PRIMARY
      ) {
        primaryPlayers.add(event.getPlayer()!.getName());
      }

      if (event.getType() === Event.Type.TOB_SOTE_MAZE_PATH) {
        const soteMaze = event.getSoteMaze();
        if (soteMaze?.getOverworldTilesList().length === 0) {
          const overworld = soteMaze.getOverworldPivotsList();
          const underworld = soteMaze.getUnderworldPivotsList();
          if (overworld.length > 0 || underworld.length > 0) {
            stageData.sotePivots.push({
              maze: soteMaze.getMaze() as Maze,
              overworld: overworld.map((c) => ({ x: c.getX(), y: c.getY() })),
              underworld: underworld.map((c) => ({ x: c.getX(), y: c.getY() })),
            });
          }
          derivedEventCount++;
          continue;
        }
      }

      const tick = event.getTick();
      if (tick <= stageInfo.recordedTicks) {
        eventsByTick[tick].push(event);
      } else {
        droppedEventCount++;
      }
    }

    if (derivedEventCount > 0) {
      logger.debug('client_derived_events_filtered', {
        challengeUuid: challenge.uuid,
        clientId,
        stage: stageInfo.stage,
        derivedEventCount,
      });
    }

    if (droppedEventCount > 0) {
      logger.warn('client_events_beyond_recorded_ticks', {
        challengeUuid: challenge.uuid,
        clientId,
        stage: stageInfo.stage,
        recordedTicks: stageInfo.recordedTicks,
        droppedEventCount,
      });
      anomalies.add(ClientAnomaly.EVENTS_BEYOND_RECORDED_TICKS);
    }

    if (primaryPlayers.size > 1) {
      logger.warn('client_multiple_primary_players', {
        challengeUuid: challenge.uuid,
        clientId,
        players: Array.from(primaryPlayers),
      });
      primaryPlayers.clear();
      anomalies.add(ClientAnomaly.MULTIPLE_PRIMARY_PLAYERS);
    }

    const primaryPlayer =
      primaryPlayers.size === 1 ? primaryPlayers.values().next().value : null;

    const playerStates = this.buildPlayerStates(
      clientId,
      eventsByTick,
      challenge.party,
    );
    const taggedByTick = eventsByTick.map((evts) =>
      evts.map((event) => ({ event, source: clientId })),
    );
    const npcsByTick = buildNpcStates(taggedByTick);
    const graphicsByTick = buildGraphicsStates(taggedByTick);
    const tickState = taggedByTick.map(
      (tagged, tick) =>
        new TickState(
          tick,
          tagged,
          new Map(
            challenge.party.map((player) => [
              player,
              playerStates[player][tick],
            ]),
          ),
          npcsByTick[tick],
          graphicsByTick[tick],
        ),
    );

    const st = stageInfo.serverTicks;
    const ticksMatch = st !== null && st.count === stageInfo.recordedTicks;
    const hasPreciseServerTicks = st?.precise ?? false;
    let derivedAccurate = hasPreciseServerTicks && ticksMatch;
    let invalidTickCount = false;

    if (st !== null && stageInfo.recordedTicks > st.count) {
      invalidTickCount = true;
      logger.warn('client_recorded_ticks_exceed_server', {
        challengeUuid: challenge.uuid,
        clientId,
        recordedTicks: stageInfo.recordedTicks,
        serverTicks: st.count,
      });
      derivedAccurate = false;
    }

    if (stageInfo.accurate && !derivedAccurate) {
      const serverTicks =
        st !== null ? `(count=${st.count},precise=${st.precise})` : 'none';
      logger.warn('client_accuracy_mismatch', {
        challengeUuid: challenge.uuid,
        clientId,
        recordedTicks: stageInfo.recordedTicks,
        serverTicks,
      });
    }

    const finalAccurate =
      stageInfo.accurate && derivedAccurate && !invalidTickCount;

    return new ClientEvents(
      clientId,
      challenge,
      stageInfo,
      finalAccurate,
      tickState,
      stageData,
      metadata,
      primaryPlayer ?? null,
      invalidTickCount,
      anomalies,
      corrections,
    );
  }

  /**
   * @returns The ID of the client that recorded these events.
   */
  public getId(): number {
    return this.clientId;
  }

  /**
   * @returns The number of ticks reported by the game server, if known.
   */
  public getServerTicks(): ServerTicks | null {
    return this.stageInfo.serverTicks;
  }

  /**
   * @returns The stage of the challenge that these events were recorded in.
   */
  public getStage(): Stage {
    return this.stageInfo.stage;
  }

  /**
   * @returns The status of the stage at the time of the last recorded event.
   */
  public getStatus(): StageStatus {
    return this.stageInfo.status;
  }

  /**
   * @returns The highest recorded tick in the client events.
   */
  public getFinalTick(): number {
    return this.stageInfo.recordedTicks;
  }

  /**
   * @returns The total number of ticks in the stage.
   */
  public getTickCount(): number {
    return this.stageInfo.recordedTicks + 1;
  }

  /**
   * @returns Whether the recorded ticks of the client's events are accurate.
   */
  public isAccurate(): boolean {
    return this.accurate;
  }

  public setAccurate(accurate: boolean): void {
    this.accurate = accurate;
  }

  /**
   * @returns Whether the client reported accurate ticks to the server.
   */
  public getReportedAccurate(): boolean {
    return this.stageInfo.accurate;
  }

  /**
   * @returns The tick states for this client.
   */
  public getTickStates(): TickStateArray {
    return [...this.tickState];
  }

  /**
   * Returns all events that occurred at the given tick.
   * @param tick The tick whose events to retrieve.
   * @returns Possibly empty array of events that were recorded.
   */
  public getTickState(tick: number): TickState | null {
    if (tick < 0 || tick > this.stageInfo.recordedTicks) {
      return null;
    }
    return this.tickState[tick];
  }

  /**
   * @returns Stage-scoped data extracted from the client's raw events.
   */
  public getStageData(): Readonly<StageData> {
    return this.stageData;
  }

  /**
   * @returns The connection metadata reported by the client.
   */
  public getMetadata(): ClientMetadata | null {
    return this.metadata;
  }

  /**
   * @returns The username of the client's primary player,
   *   or `null` if the client is a spectator.
   */
  public getPrimaryPlayer(): string | null {
    return this.primaryPlayer;
  }

  /**
   * @returns Whether this client recorded data without being a participant.
   */
  public isSpectator(): boolean {
    return this.primaryPlayer === null;
  }

  public toString(): string {
    return `Client#${this.clientId}[${this.primaryPlayer ?? 'spectator'}]`;
  }

  public hasInvalidTickCount(): boolean {
    return this.invalidTickCount;
  }

  public hasConsistencyIssues(): boolean {
    return this.consistencyIssues.length > 0;
  }

  public getConsistencyIssues(): ConsistencyIssue[] {
    return [...this.consistencyIssues];
  }

  public getAnomalies(): ClientAnomaly[] {
    return Array.from(this.anomalies);
  }

  public hasAnomaly(anomaly: ClientAnomaly): boolean {
    return this.anomalies.has(anomaly);
  }

  public getCorrections(): ClientGameCorrection[] {
    return [...this.corrections];
  }

  /**
   * Performs a cursory check for consistency in the client's recorded events,
   * looking for obvious indications of tick loss.
   * @returns `false` if any major inconsistencies are found, `true` otherwise.
   */
  private checkForConsistency(): boolean {
    const issues: ConsistencyIssue[] = [];

    try {
      issues.push(
        ...new MovementConsistencyChecker(
          this.stageInfo.stage,
          this.challenge.party,
        ).check(this.tickState),
      );

      const stageChecker = consistencyCheckerForStage(
        this.stageInfo.stage,
        this.challenge.mode,
      );
      if (stageChecker !== null) {
        issues.push(...stageChecker.check(this.tickState));
      }
    } catch (e) {
      logger.error('client_consistency_check_error', {
        challengeUuid: this.challenge.uuid,
        clientId: this.clientId,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
      this.anomalies.add(ClientAnomaly.BAD_DATA);
    }

    for (const issue of issues) {
      logger.warn('client_consistency_issue', {
        challengeUuid: this.challenge.uuid,
        clientId: this.clientId,
        issue,
      });
    }

    this.consistencyIssues = issues;

    const badDataIssues = issues.filter(
      (i) => i.type === ConsistencyIssueType.BAD_DATA,
    );
    if (badDataIssues.length > 0) {
      logger.error('client_bad_data', {
        challengeUuid: this.challenge.uuid,
        clientId: this.clientId,
        failedChecks: badDataIssues.length,
      });
      this.anomalies.add(ClientAnomaly.BAD_DATA);
    }
    if (issues.length > 0) {
      this.anomalies.add(ClientAnomaly.CONSISTENCY_ISSUES);
    }
    return issues.length === 0;
  }

  private constructor(
    clientId: number,
    challenge: ChallengeInfo,
    stageInfo: StageInfo,
    accurate: boolean,
    tickState: TickState[],
    stageData: StageData,
    metadata: ClientMetadata | null,
    primaryPlayer: string | null,
    invalidTickCount: boolean,
    anomalies: Set<ClientAnomaly>,
    corrections: ClientGameCorrection[],
  ) {
    this.clientId = clientId;
    this.challenge = challenge;
    this.stageInfo = stageInfo;
    this.tickState = tickState;
    this.stageData = stageData;
    this.metadata = metadata;
    this.primaryPlayer = primaryPlayer;
    this.invalidTickCount = invalidTickCount;
    this.anomalies = anomalies;
    this.corrections = corrections;
    this.consistencyIssues = [];

    const ok = this.checkForConsistency();
    this.accurate = accurate && ok;
  }

  private static buildPlayerStates(
    clientId: number,
    eventsByTick: Event[][],
    party: string[],
  ): Record<string, (WithProvenance<PlayerState> | null)[]> {
    const playerStates: Record<string, (WithProvenance<PlayerState> | null)[]> =
      {};

    for (const player of party) {
      const states = Array(eventsByTick.length).fill(null);
      let lastState: WithProvenance<PlayerState> | null = null;

      let isDead = false;

      for (let tick = 0; tick < eventsByTick.length; tick++) {
        const tickEvents = eventsByTick[tick];
        if (!tickEvents) {
          continue;
        }

        eventsByTick[tick] = tickEvents;

        const playerEvents = tickEvents.filter(
          (event) =>
            (event.getType() === Event.Type.PLAYER_UPDATE ||
              event.getType() === Event.Type.PLAYER_ATTACK ||
              event.getType() === Event.Type.PLAYER_SPELL ||
              event.getType() === Event.Type.PLAYER_DEATH) &&
            event.getPlayer()?.getName() === player,
        );

        if (playerEvents.length === 0) {
          continue;
        }

        const state: WithProvenance<PlayerState> = {
          source: DataSource.SECONDARY,
          username: player,
          x: lastState?.x ?? 0,
          y: lastState?.y ?? 0,
          isDead,
          equipment: lastState?.equipment
            ? { ...lastState.equipment }
            : { ...EMPTY_EQUIPMENT },
          attack: null,
          spell: null,
          stats: null,
          offCooldownTick: null,
          prayers: PrayerSet.empty(PrayerBook.NORMAL),
          sourceClientId: clientId,
        };

        playerEvents.forEach((event) => {
          switch (event.getType()) {
            case Event.Type.PLAYER_UPDATE: {
              const player = event.getPlayer()!;

              state.source = player.getDataSource();
              state.x = event.getXCoord();
              state.y = event.getYCoord();
              state.prayers = PrayerSet.fromRaw(player.getActivePrayers());
              state.stats = readPlayerStats(player);

              // A snapshot carries the player's full equipment, so reconstruct
              // from an empty container rather than the previous tick's state.
              state.equipment = {
                ...EMPTY_EQUIPMENT,
                ...applyItemDeltas(
                  player.getEquipmentDeltasList(),
                  player.getSnapshot() ? null : state.equipment,
                ),
              };
              break;
            }

            case Event.Type.PLAYER_DEATH: {
              isDead = true;
              state.isDead = true;
              break;
            }

            case Event.Type.PLAYER_ATTACK: {
              const attack = event.getPlayerAttack()!;
              state.attack = {
                type: attack.getType(),
                weaponId: attack.getWeapon()?.getId() ?? 0,
                distanceToTarget: attack.getDistanceToTarget(),
                target: null,
                sourceClientId: clientId,
              };
              if (attack.hasTarget()) {
                const target = attack.getTarget()!;
                // Jagex moment: defend against invalid target data.
                if (target.getId() > 0 && target.getRoomId() > 0) {
                  state.attack.target = {
                    id: target.getId(),
                    roomId: target.getRoomId(),
                    sourceClientId: clientId,
                  };
                }
              }
              break;
            }

            case Event.Type.PLAYER_SPELL: {
              const spell = event.getPlayerSpell()!;
              state.spell = {
                type: spell.getType(),
                target: null,
                sourceClientId: clientId,
              };
              if (spell.hasTargetPlayer()) {
                state.spell.target = {
                  kind: 'player',
                  name: spell.getTargetPlayer(),
                  sourceClientId: clientId,
                };
              } else if (spell.hasTargetNpc()) {
                const npc = spell.getTargetNpc()!;
                state.spell.target = {
                  kind: 'npc',
                  id: npc.getId(),
                  roomId: npc.getRoomId(),
                  sourceClientId: clientId,
                };
              }
              break;
            }
          }
        });

        states[tick] = state;
        lastState = state;
      }

      playerStates[player] = states as (PlayerState | null)[];
    }

    return playerStates;
  }
}

function readPlayerStats(player: Event.Player): PlayerStats | null {
  const stats: PlayerStats = {
    hitpoints: player.hasHitpoints()
      ? SkillLevel.fromRaw(player.getHitpoints())
      : null,
    prayer: player.hasPrayer() ? SkillLevel.fromRaw(player.getPrayer()) : null,
    attack: player.hasAttack() ? SkillLevel.fromRaw(player.getAttack()) : null,
    strength: player.hasStrength()
      ? SkillLevel.fromRaw(player.getStrength())
      : null,
    defence: player.hasDefence()
      ? SkillLevel.fromRaw(player.getDefence())
      : null,
    ranged: player.hasRanged() ? SkillLevel.fromRaw(player.getRanged()) : null,
    magic: player.hasMagic() ? SkillLevel.fromRaw(player.getMagic()) : null,
  };
  if (Object.values(stats).every((v) => v === null)) {
    return null;
  }
  return stats;
}
