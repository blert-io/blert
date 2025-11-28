import {
  ClientStageStream,
  DataSource,
  EquipmentSlot,
  EventType,
  ItemDelta,
  Stage,
  StageStatus,
  StageStreamEnd,
  StageStreamEvents,
  StageStreamType,
} from '@blert/common';
import { ChallengeEvents } from '@blert/common/generated/challenge_storage_pb';
import { Event } from '@blert/common/generated/event_pb';

import logger from '../log';
import { ChallengeInfo } from './merge';
import { PlayerState, TickState } from './tick-state';

export const enum ClientAnomaly {
  MULTIPLE_PRIMARY_PLAYERS = 'MULTIPLE_PRIMARY_PLAYERS',
  MISSING_STAGE_METADATA = 'MISSING_STAGE_METADATA',
  CONSISTENCY_ISSUES = 'CONSISTENCY_ISSUES',
}

export type ConsistencyIssue = {
  player: string;
  delta: { x: number; y: number };
  ticksSinceLast: number;
  lastTick: number;
  currentTick: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
};

export type ServerTicks = {
  count: number;
  precise: boolean;
};

export type StageInfo = {
  stage: Stage;
  status: StageStatus;
  accurate: boolean;
  recordedTicks: number;
  serverTicks: ServerTicks | null;
};

// Tiles where players are teleported at the start and end of Sotetseg's maze.
const SOTETSEG_OVERWORLD_MAZE_START_TILE = { x: 3274, y: 4307 };
const SOTETSEG_UNDERWORLD_MAZE_START_TILE = { x: 3360, y: 4309 };
const SOTETSEG_MAZE_END_TILE = { x: 3275, y: 4327 };
const SOTETSEG_ROOM_AREA = { x: 3271, y: 4304, width: 17, height: 30 };
const SOTETSEG_UNDERWORLD_AREA = { x: 3354, y: 4309, width: 14, height: 22 };

interface CoordsLike {
  x: number;
  y: number;
}

interface AreaLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

function coordsEqual(a: CoordsLike, b: CoordsLike): boolean {
  return a.x === b.x && a.y === b.y;
}

function inArea(coords: CoordsLike, area: AreaLike): boolean {
  return (
    coords.x >= area.x &&
    coords.x < area.x + area.width &&
    coords.y >= area.y &&
    coords.y < area.y + area.height
  );
}

export class ClientEvents {
  private readonly clientId: number;
  private readonly challenge: ChallengeInfo;
  private readonly stageInfo: Readonly<StageInfo>;
  private readonly tickState: TickState[];
  private readonly primaryPlayer: string | null;
  private readonly eventsByType: Map<EventType, readonly Event[]>;
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
        const update = (stream as StageStreamEnd).update;
        stageInfo.status = update.status;
        stageInfo.accurate = update.accurate;
        stageInfo.recordedTicks = update.recordedTicks;
        stageInfo.serverTicks = update.serverTicks;
        sawStageEnd = true;
      } else if (stream.type === StageStreamType.STAGE_EVENTS) {
        const message = ChallengeEvents.deserializeBinary(
          (stream as StageStreamEvents).events,
        );
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

    for (const event of events) {
      if (
        event.getType() === Event.Type.PLAYER_UPDATE &&
        event.getPlayer()!.getDataSource() === DataSource.PRIMARY
      ) {
        primaryPlayers.add(event.getPlayer()!.getName());
      }

      eventsByTick[event.getTick()].push(event);
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
          evts,
          challenge.party.reduce(
            (acc, player) => ({ ...acc, [player]: playerStates[player][tick] }),
            {},
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
      events,
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
    const lastPlayerStates: Record<
      string,
      (PlayerState & { tick: number }) | null
    > = this.challenge.party.reduce(
      (acc, player) => ({
        ...acc,
        [player]: null,
      }),
      {},
    );

    let ok = true;
    const issues: ConsistencyIssue[] = [];

    for (let tick = 0; tick <= this.stageInfo.recordedTicks; tick++) {
      for (const player of this.challenge.party) {
        const playerState =
          this.tickState[tick]?.getPlayerState(player) ?? null;
        if (playerState === null) {
          continue;
        }

        if (lastPlayerStates[player] !== null) {
          const last = lastPlayerStates[player];
          const ticksSinceLast = tick - last.tick;

          // Players can move at most 2 tiles per tick -- anything more is a
          // likely indication of tick loss.
          const dx = playerState.x - last.x;
          const dy = playerState.y - last.y;

          const maxDistance = 2 * ticksSinceLast;
          const invalidMove =
            !playerState.isDead &&
            (Math.abs(dx) > maxDistance || Math.abs(dy) > maxDistance) &&
            !this.isSpecialTeleport(tick, last, playerState, ticksSinceLast);

          if (invalidMove) {
            logger.info('client_consistency_issue', {
              challengeUuid: this.challenge.uuid,
              clientId: this.clientId,
              player,
              delta: { x: dx, y: dy },
              ticksSinceLast,
              lastTick: last.tick,
              currentTick: tick,
              stage: this.stageInfo.stage,
              start: { x: last.x, y: last.y },
              end: { x: playerState.x, y: playerState.y },
            });

            ok = false;
            issues.push({
              player,
              delta: { x: dx, y: dy },
              ticksSinceLast,
              lastTick: last.tick,
              currentTick: tick,
              start: { x: last.x, y: last.y },
              end: { x: playerState.x, y: playerState.y },
            });
          }
        }

        lastPlayerStates[player] = { ...playerState, tick };
      }
    }

    this.consistencyIssues = issues;
    if (issues.length > 0) {
      this.anomalies.add(ClientAnomaly.CONSISTENCY_ISSUES);
    }
    return ok;
  }

  private constructor(
    clientId: number,
    challenge: ChallengeInfo,
    stageInfo: StageInfo,
    accurate: boolean,
    tickState: TickState[],
    rawEvents: readonly Event[],
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

    const eventsByType = new Map<EventType, Event[]>();
    for (const event of rawEvents) {
      if (!eventsByType.has(event.getType())) {
        eventsByType.set(event.getType(), []);
      }
      eventsByType.get(event.getType())!.push(event);
    }
    this.eventsByType = eventsByType;

    // TODO(frolv): Demote accurate clients that have consistency issues.
    const _ok = this.checkForConsistency();
    this.accurate = accurate;
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
        };

        playerEvents.forEach((event) => {
          switch (event.getType()) {
            case Event.Type.PLAYER_UPDATE: {
              const player = event.getPlayer()!;

              state.source = player.getDataSource();
              state.x = event.getXCoord();
              state.y = event.getYCoord();

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
          }
        });

        states[tick] = state;
        lastState = state;
      }

      playerStates[player] = states as (PlayerState | null)[];
    }

    return playerStates;
  }

  /**
   * Checks if a player's movement between two positions is a special teleport
   * within a specific boss fight.
   *
   * @param tick The tick at which the player's movement occurred.
   * @param last Player's last known state.
   * @param current Player's current state.
   * @param deltaTicks Number of ticks between the two states.
   * @returns Whether the player's movement between the two states is a teleport.
   */
  private isSpecialTeleport(
    tick: number,
    last: PlayerState,
    current: PlayerState,
    deltaTicks: number,
  ): boolean {
    switch (this.stageInfo.stage) {
      case Stage.TOB_SOTETSEG: {
        // Handle teleports occurring during a Sotetseg maze.
        if (deltaTicks !== 1) {
          return false;
        }

        // Teleporting back out of the maze after completion.
        if (coordsEqual(current, SOTETSEG_MAZE_END_TILE)) {
          return inArea(last, SOTETSEG_UNDERWORLD_AREA);
        }

        // Being chosen to run the maze.
        if (coordsEqual(current, SOTETSEG_UNDERWORLD_MAZE_START_TILE)) {
          return inArea(last, SOTETSEG_ROOM_AREA);
        }

        // Teleporting to the start of the maze. This can happen either from the
        // overworld (regular maze) or the underworld (solo maze).
        if (coordsEqual(current, SOTETSEG_OVERWORLD_MAZE_START_TILE)) {
          return (
            inArea(last, SOTETSEG_ROOM_AREA) ||
            inArea(last, SOTETSEG_UNDERWORLD_AREA)
          );
        }

        return false;
      }

      case Stage.TOB_VERZIK: {
        // Verzik's bounce pushes a player back by 3 tiles.
        if (deltaTicks !== 1) {
          return false;
        }

        const chebyshev = Math.max(
          Math.abs(current.x - last.x),
          Math.abs(current.y - last.y),
        );
        if (chebyshev !== 3) {
          return false;
        }

        const potentialBounceTick = tick - 1;

        const bounceEvent = this.eventsByType
          .get(Event.Type.TOB_VERZIK_BOUNCE)
          ?.find((evt) => {
            const bounce = evt.getVerzikBounce()!;
            return (
              bounce.getNpcAttackTick() === potentialBounceTick &&
              bounce.getBouncedPlayer() === current.username
            );
          });

        return bounceEvent !== undefined;
      }

      default: {
        return false;
      }
    }
  }
}
