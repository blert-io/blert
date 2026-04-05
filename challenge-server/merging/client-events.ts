import {
  ClientStageStream,
  DataSource,
  EquipmentSlot,
  ItemDelta,
  PrayerBook,
  PrayerSet,
  Stage,
  StageStatus,
  StageStreamType,
} from '@blert/common';
import { ChallengeEvents } from '@blert/common/generated/challenge_storage_pb';
import { Event } from '@blert/common/generated/event_pb';

import logger from '../log';
import { ChallengeInfo } from './merge';
import { PlayerState, TickState, TickStateArray } from './tick-state';
import {
  consistencyCheckerForStage,
  ConsistencyIssue,
  ConsistencyIssueType,
  MovementConsistencyChecker,
} from './consistency';

export const enum ClientAnomaly {
  MULTIPLE_PRIMARY_PLAYERS = 'MULTIPLE_PRIMARY_PLAYERS',
  MISSING_STAGE_METADATA = 'MISSING_STAGE_METADATA',
  CONSISTENCY_ISSUES = 'CONSISTENCY_ISSUES',
  EVENTS_BEYOND_RECORDED_TICKS = 'EVENTS_BEYOND_RECORDED_TICKS',
  BAD_DATA = 'BAD_DATA',
}

export type ServerTicks = {
  count: number;
  precise: boolean;
};

type StageInfo = {
  stage: Stage;
  status: StageStatus;
  accurate: boolean;
  recordedTicks: number;
  serverTicks: ServerTicks | null;
};

export class ClientEvents {
  private readonly clientId: number;
  private readonly challenge: ChallengeInfo;
  private readonly stageInfo: Readonly<StageInfo>;
  private readonly tickState: TickState[];
  private readonly primaryPlayer: string | null;
  private readonly invalidTickCount: boolean;
  private readonly anomalies: Set<ClientAnomaly>;
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
    let sawStageEnd = false;

    for (const stream of streamEvents) {
      if (stream.type === StageStreamType.STAGE_END) {
        const update = stream.update;
        stageInfo.status = update.status;
        stageInfo.accurate = update.accurate;
        stageInfo.recordedTicks = update.recordedTicks;
        stageInfo.serverTicks = update.serverTicks;
        sawStageEnd = true;
      } else if (stream.type === StageStreamType.STAGE_EVENTS) {
        const message = ChallengeEvents.deserializeBinary(stream.events);
        events.push(...message.getEventsList());
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
   * @returns Structured client events.
   */
  public static fromRawEvents(
    clientId: number,
    challenge: ChallengeInfo,
    stageInfo: StageInfo,
    rawEvents: Event[],
    anomaliesParam?: Set<ClientAnomaly>,
  ): ClientEvents {
    const anomalies = anomaliesParam ?? new Set<ClientAnomaly>();

    const events = [...rawEvents].sort((a, b) => a.getTick() - b.getTick());
    if (stageInfo.recordedTicks === 0 && events.length > 0) {
      stageInfo.recordedTicks = events[events.length - 1].getTick();
    }

    const primaryPlayers = new Set<string>();

    const eventsByTick: Event[][] = Array.from(
      { length: stageInfo.recordedTicks + 1 },
      () => [],
    );

    let droppedEventCount = 0;

    for (const event of events) {
      if (
        event.getType() === Event.Type.PLAYER_UPDATE &&
        event.getPlayer()!.getDataSource() === DataSource.PRIMARY
      ) {
        primaryPlayers.add(event.getPlayer()!.getName());
      }

      const tick = event.getTick();
      if (tick <= stageInfo.recordedTicks) {
        eventsByTick[tick].push(event);
      } else {
        droppedEventCount++;
      }
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

    const playerStates = this.buildPlayerStates(eventsByTick, challenge.party);
    const tickState = eventsByTick.map(
      (evts, tick) =>
        new TickState(
          tick,
          evts.map((event) => ({ event, source: clientId })),
          new Map(
            challenge.party.map((player) => [
              player,
              playerStates[player][tick],
            ]),
          ),
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
      primaryPlayer ?? null,
      invalidTickCount,
      anomalies,
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

  /**
   * Performs a cursory check for consistency in the client's recorded events,
   * looking for obvious indications of tick loss.
   * @returns `false` if any major inconsistencies are found, `true` otherwise.
   */
  private checkForConsistency(): boolean {
    const issues: ConsistencyIssue[] = [
      ...new MovementConsistencyChecker(
        this.stageInfo.stage,
        this.challenge.party,
      ).check(this.tickState),
    ];

    const stageChecker = consistencyCheckerForStage(
      this.stageInfo.stage,
      this.challenge.mode,
    );
    if (stageChecker !== null) {
      issues.push(...stageChecker.check(this.tickState));
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
    primaryPlayer: string | null,
    invalidTickCount: boolean,
    anomalies: Set<ClientAnomaly>,
  ) {
    this.clientId = clientId;
    this.challenge = challenge;
    this.stageInfo = stageInfo;
    this.tickState = tickState;
    this.primaryPlayer = primaryPlayer;
    this.invalidTickCount = invalidTickCount;
    this.anomalies = anomalies;
    this.consistencyIssues = [];

    const ok = this.checkForConsistency();
    this.accurate = accurate && ok;
  }

  private static buildPlayerStates(
    eventsByTick: Event[][],
    party: string[],
  ): Record<string, (PlayerState | null)[]> {
    const playerStates: Record<string, (PlayerState | null)[]> = {};

    for (const player of party) {
      const states = Array(eventsByTick.length).fill(null);
      let lastState: PlayerState | null = null;

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
              event.getType() === Event.Type.PLAYER_DEATH) &&
            event.getPlayer()?.getName() === player,
        );

        if (playerEvents.length === 0) {
          continue;
        }

        const state: PlayerState = {
          source: DataSource.SECONDARY,
          username: player,
          x: lastState?.x ?? 0,
          y: lastState?.y ?? 0,
          isDead,
          equipment: lastState?.equipment
            ? { ...lastState.equipment }
            : {
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
              },
          attack: null,
          prayers: PrayerSet.empty(PrayerBook.NORMAL),
        };

        playerEvents.forEach((event) => {
          switch (event.getType()) {
            case Event.Type.PLAYER_UPDATE: {
              const player = event.getPlayer()!;

              state.source = player.getDataSource();
              state.x = event.getXCoord();
              state.y = event.getYCoord();
              state.prayers = PrayerSet.fromRaw(player.getActivePrayers());

              player.getEquipmentDeltasList().forEach((rawDelta) => {
                const delta = ItemDelta.fromRaw(rawDelta);
                const previous = state.equipment[delta.getSlot()];

                if (delta.isAdded()) {
                  if (previous?.id !== delta.getItemId()) {
                    state.equipment[delta.getSlot()] = {
                      id: delta.getItemId(),
                      quantity: delta.getQuantity(),
                    };
                  } else {
                    state.equipment[delta.getSlot()] = {
                      id: delta.getItemId(),
                      quantity: previous.quantity + delta.getQuantity(),
                    };
                  }
                } else {
                  if (previous !== null && previous.id === delta.getItemId()) {
                    if (delta.getQuantity() < previous.quantity) {
                      state.equipment[delta.getSlot()] = {
                        id: delta.getItemId(),
                        quantity: previous.quantity - delta.getQuantity(),
                      };
                    } else {
                      state.equipment[delta.getSlot()] = null;
                    }
                  } else {
                    state.equipment[delta.getSlot()] = null;
                  }
                }
              });
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
                target: attack.getTarget()?.getRoomId() ?? null,
              };
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
