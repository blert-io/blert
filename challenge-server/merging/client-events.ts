import {
  ClientStageStream,
  DataSource,
  EquipmentSlot,
  EventType,
  isColosseumStage,
  isCoxStage,
  isInfernoStage,
  isMokhaiotlStage,
  isToaStage,
  ItemDelta,
  Npc,
  NpcAttack,
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

function chebyshev(a: CoordsLike, b: CoordsLike): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// Tile to which players are teleported at the start of Sotetseg's maze.
const SOTETSEG_OVERWORLD_MAZE_START_TILE = { x: 3274, y: 4307 };
const SOTETSEG_ROOM_AREA = { x: 3271, y: 4304, width: 17, height: 30 };
const SOTETSEG_UNDERWORLD_AREA = { x: 3354, y: 4309, width: 14, height: 22 };

// Tiles within melee range of Verzik's fixed 3x3 P2 location.
const VERZIK_P2_BOUNCEABLE_AREA = { x: 3166, y: 4312, width: 5, height: 5 };
const VERZIK_P2_CENTER_TILE = { x: 3168, y: 4314 };

// Tiles within Verzik's 7x7 P3 location during webs.
const VERZIK_P3_WEBS_AREA = { x: 3165, y: 4309, width: 7, height: 7 };
const VERZIK_P3_WEBS_CENTER_TILE = { x: 3168, y: 4312 };

function isValidP2BounceDestination(coords: CoordsLike): boolean {
  const distance = chebyshev(coords, VERZIK_P2_CENTER_TILE);
  return distance === 5 || distance === 6;
}

function isValidP3WebsPushDestination(coords: CoordsLike): boolean {
  return chebyshev(coords, VERZIK_P3_WEBS_CENTER_TILE) === 4;
}

const DEATH_AREAS_BY_STAGE: Partial<Record<Stage, AreaLike[]>> = {
  [Stage.TOB_MAIDEN]: [
    { x: 3166, y: 4433, width: 2, height: 1 },
    { x: 3166, y: 4460, width: 2, height: 1 },
  ],
  [Stage.TOB_BLOAT]: [
    { x: 3295, y: 4436, width: 2, height: 1 },
    { x: 3295, y: 4459, width: 2, height: 1 },
  ],
  [Stage.TOB_NYLOCAS]: [
    { x: 3290, y: 4240, width: 1, height: 1 },
    { x: 3301, y: 4240, width: 1, height: 1 },
    { x: 3287, y: 4243, width: 1, height: 1 },
    { x: 3304, y: 4243, width: 1, height: 1 },
    { x: 3287, y: 4254, width: 1, height: 1 },
    { x: 3304, y: 4254, width: 1, height: 1 },
    { x: 3290, y: 4257, width: 1, height: 1 },
    { x: 3301, y: 4257, width: 1, height: 1 },
  ],
  [Stage.TOB_SOTETSEG]: [
    { x: 3270, y: 4313, width: 1, height: 2 },
    { x: 3289, y: 4313, width: 1, height: 2 },
  ],
  [Stage.TOB_XARPUS]: [{ x: 3156, y: 4381, width: 2, height: 13 }],
  [Stage.TOB_VERZIK]: [
    { x: 3157, y: 4325, width: 5, height: 1 },
    { x: 3175, y: 4325, width: 5, height: 1 },
  ],
};

function isInDeathArea(stage: Stage, coords: CoordsLike): boolean {
  return (
    DEATH_AREAS_BY_STAGE[stage]?.some((area) => inArea(coords, area)) ?? false
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
          const maxDistance = 2 * ticksSinceLast;
          const invalidMove =
            !playerState.isDead &&
            chebyshev(playerState, last) > maxDistance &&
            !this.isSpecialTeleport(tick, last, playerState, ticksSinceLast);

          if (invalidMove) {
            const dx = playerState.x - last.x;
            const dy = playerState.y - last.y;

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
    if (isInDeathArea(this.stageInfo.stage, current)) {
      return true;
    }

    if (isInfernoStage(this.stageInfo.stage)) {
      return false;
    }
    if (isMokhaiotlStage(this.stageInfo.stage)) {
      return false;
    }
    if (isColosseumStage(this.stageInfo.stage)) {
      return false;
    }

    switch (this.stageInfo.stage) {
      case Stage.TOB_SOTETSEG: {
        // Maze teleports between the overworld and underworld are special
        // teleports by definition.
        if (
          inArea(current, SOTETSEG_UNDERWORLD_AREA) &&
          inArea(last, SOTETSEG_ROOM_AREA)
        ) {
          return true;
        }
        if (
          inArea(current, SOTETSEG_ROOM_AREA) &&
          inArea(last, SOTETSEG_UNDERWORLD_AREA)
        ) {
          return true;
        }

        // Otherwise, the only special teleport that occurs is going from
        // anywhere in the room to the start of the maze when it procs. This
        // must be a one-tick movement.
        return (
          deltaTicks === 1 &&
          inArea(last, SOTETSEG_ROOM_AREA) &&
          coordsEqual(current, SOTETSEG_OVERWORLD_MAZE_START_TILE)
        );
      }

      case Stage.TOB_VERZIK: {
        if (deltaTicks !== 1) {
          return false;
        }

        // Check the previous tick's NPC because a bounce can happen right on a
        // phase transition.
        const verzikNpc = this.tickState[tick - 1]
          ?.getNpcs()
          .values()
          .find((npc) => Npc.isVerzik(npc.id));
        if (verzikNpc === undefined) {
          return false;
        }

        if (Npc.isVerzikP2(verzikNpc.id)) {
          return this.checkForP2Bounce(tick, last, current);
        }

        if (Npc.isVerzikP3(verzikNpc.id)) {
          return this.checkForP3WebsPush(tick, last, current);
        }

        return false;
      }

      case Stage.TOB_MAIDEN:
      case Stage.TOB_BLOAT:
      case Stage.TOB_NYLOCAS:
      case Stage.TOB_XARPUS:
        // These stages have no special teleports.
        return false;

      case Stage.UNKNOWN:
        return false;
    }

    // TODO(frolv): These challenges are not yet supported.
    if (isCoxStage(this.stageInfo.stage) || isToaStage(this.stageInfo.stage)) {
      return false;
    }

    const _exhaustive: never = this.stageInfo.stage;
    return false;
  }

  private checkForP2Bounce(
    tick: number,
    last: PlayerState,
    current: PlayerState,
  ): boolean {
    // Verzik's bounce pushes a player away from under or adjacent to her.
    if (
      !inArea(last, VERZIK_P2_BOUNCEABLE_AREA) ||
      !isValidP2BounceDestination(current)
    ) {
      return false;
    }

    const potentialBounceTick = tick - 1;

    const bounceEvent = this.eventsByType
      .get(Event.Type.TOB_VERZIK_BOUNCE)
      ?.find((evt) => {
        const bounce = evt.getVerzikBounce()!;
        const validTick =
          bounce.getNpcAttackTick() === potentialBounceTick ||
          bounce.getNpcAttackTick() === tick;
        return validTick && bounce.getBouncedPlayer() === current.username;
      });

    if (bounceEvent !== undefined) {
      return true;
    }

    // It's possible for a client to miss the bounce event, in which case we
    // fall back to the presence of a bounce attack, which indicates that
    // Verzik performed the bounce animation, but without knowing the
    // target.
    //
    // Verzik's bounce targets a single player, so if the bounce attack is
    // present, we ensure that only the player we are checking made a
    // bounce-like movement.
    const hasBounce = (tickState: TickState | null): boolean => {
      return (
        tickState?.getEventsByType(Event.Type.NPC_ATTACK)?.find((evt) => {
          const attack = evt.getNpcAttack()!;
          return attack.getAttack() === NpcAttack.TOB_VERZIK_P2_BOUNCE;
        }) !== undefined
      );
    };

    if (
      !hasBounce(this.tickState[potentialBounceTick]) &&
      !hasBounce(this.tickState[tick])
    ) {
      return false;
    }

    let bounceLikeMovements = 0;
    let playerWasBounced = false;

    for (const player of this.challenge.party) {
      const curr = this.tickState[tick]?.getPlayerState(player);
      const prev = this.tickState[tick - 1]?.getPlayerState(player);
      if (!curr || !prev) {
        continue;
      }

      if (
        inArea(prev, VERZIK_P2_BOUNCEABLE_AREA) &&
        isValidP2BounceDestination(curr)
      ) {
        bounceLikeMovements++;
        if (player === current.username) {
          playerWasBounced = true;
        }
      }
    }

    return playerWasBounced && bounceLikeMovements === 1;
  }

  private checkForP3WebsPush(
    tick: number,
    last: PlayerState,
    current: PlayerState,
  ): boolean {
    // When webs starts, players under Verzik are pushed directly outside of
    // her area.
    let isWebs = false;

    for (let t = tick; t >= Math.max(tick - 3, 0); t--) {
      const tickState = this.tickState[t];
      if (!tickState) {
        continue;
      }

      const websAttack = tickState
        .getEventsByType(Event.Type.NPC_ATTACK)
        ?.find((evt) => {
          const attack = evt.getNpcAttack()!;
          return attack.getAttack() === NpcAttack.TOB_VERZIK_P3_WEBS;
        });
      if (websAttack !== undefined) {
        isWebs = true;
        break;
      }
    }

    return (
      isWebs &&
      inArea(last, VERZIK_P3_WEBS_AREA) &&
      isValidP3WebsPushDestination(current)
    );
  }
}
