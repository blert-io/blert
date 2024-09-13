import {
  DataSource,
  EquipmentSlot,
  ItemDelta,
  Stage,
  StageStatus,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import logger from './log';
import { ChallengeInfo, PlayerState, TickState } from './merge';

export type StageInfo = {
  stage: Stage;
  status: StageStatus;
  accurate: boolean;
  recordedTicks: number;
  serverTicks: number | null;
};

export class ClientEvents {
  private readonly clientId: number;
  private readonly challenge: ChallengeInfo;
  private readonly stageInfo: StageInfo;
  private readonly tickState: TickState[];
  private readonly primaryPlayer: string | null;

  public static fromRawEvents(
    clientId: number,
    challenge: ChallengeInfo,
    stageInfo: StageInfo,
    rawEvents: Event[],
  ): ClientEvents {
    const events = [...rawEvents].sort((a, b) => a.getTick() - b.getTick());

    if (stageInfo.recordedTicks === 0) {
      stageInfo.recordedTicks = events[events.length - 1].getTick() ?? 0;
    }

    const primaryPlayers = new Set<string>();

    const eventsByTick: Array<Event[]> = Array(
      stageInfo.recordedTicks + 1,
    ).fill([]);
    events.forEach((event) => {
      if (
        event.getType() === Event.Type.PLAYER_UPDATE &&
        event.getPlayer()!.getDataSource() === DataSource.PRIMARY
      ) {
        primaryPlayers.add(event.getPlayer()!.getName());
      }

      eventsByTick[event.getTick()] = [...eventsByTick[event.getTick()], event];
    });

    if (primaryPlayers.size > 1) {
      logger.warn(
        `Client reported multiple primary players: ${Array.from(primaryPlayers).join(', ')}`,
      );
      logger.warn(
        'Treating client as a spectator (ignoring primary player data)',
      );
      primaryPlayers.clear();
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

    return new ClientEvents(
      clientId,
      challenge,
      stageInfo,
      tickState,
      primaryPlayer,
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
  public getServerTicks(): number | null {
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
    return this.stageInfo.accurate;
  }

  public setAccurate(accurate: boolean): void {
    this.stageInfo.accurate = accurate;
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
    return `Client#${this.clientId}`;
  }

  /**
   * Performs a cursory check for consistency in the client's recorded events,
   * looking for obvious indications of tick loss.
   * @returns `false` if any major inconsistencies are found, `true` otherwise.
   */
  public checkForConsistency(): boolean {
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
    const potentialLostTicks = new Set<number>();

    for (let tick = 0; tick <= this.stageInfo.recordedTicks; tick++) {
      for (const player of this.challenge.party) {
        const playerState = this.tickState[tick].getPlayerState(player);
        if (playerState === null) {
          continue;
        }

        if (lastPlayerStates[player] !== null) {
          const last = lastPlayerStates[player]!;
          const ticksSinceLast = tick - last.tick;

          // Players can move at most 2 tiles per tick -- anything more is a
          // likely indication of tick loss.
          const dx = playerState.x - last.x;
          const dy = playerState.y - last.y;

          const maxDistance = 2 * ticksSinceLast;
          const invalidMove =
            (Math.abs(dx) > maxDistance || Math.abs(dy) > maxDistance) &&
            !isSpecialTeleport(
              this.stageInfo.stage,
              last,
              playerState,
              ticksSinceLast,
            );

          if (invalidMove) {
            logger.debug(
              `Client#${this.clientId} consistency issue: ` +
                `player ${player} moved (${dx}, ${dy}) in ${ticksSinceLast} ticks`,
            );

            ok = false;
            potentialLostTicks.add(tick - 1);
          }
        }

        lastPlayerStates[player] = { ...playerState, tick };
      }
    }

    return ok;
  }

  private constructor(
    clientId: number,
    challenge: ChallengeInfo,
    stageInfo: StageInfo,
    tickState: TickState[],
    primaryPlayer: string | null,
  ) {
    this.clientId = clientId;
    this.challenge = challenge;
    this.stageInfo = stageInfo;
    this.tickState = tickState;
    this.primaryPlayer = primaryPlayer;
  }

  private static buildPlayerStates(
    eventsByTick: Event[][],
    party: string[],
  ): Record<string, Array<PlayerState | null>> {
    const playerStates: Record<string, Array<PlayerState | null>> = {};

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

        let state: PlayerState = {
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
                  if (previous === null || previous.id !== delta.getItemId()) {
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

      playerStates[player] = states;
    }

    return playerStates;
  }
}

// The tiles to which players are teleported at the start of Sotetseg's maze.
const SOTETSEG_OVERWORLD_MAZE_START_TILE = { x: 3274, y: 4307 };
const SOTETSEG_UNDERWORLD_MAZE_START_TILE = { x: 3360, y: 4309 };
const SOTETSEG_ROOM_AREA = { x: 3271, y: 4304, width: 17, height: 30 };

/**
 * Checks if a player's movement between two positions is a special teleport
 * within a specific boss fight.
 *
 * @param stage The challenge stage the player is in.
 * @param last Player's last known state.
 * @param current Player's current state.
 * @param ticks Number of ticks between the two states.
 * @returns Whether the player's movement between the two states is a teleport.
 */
function isSpecialTeleport(
  stage: Stage,
  last: PlayerState,
  current: PlayerState,
  ticks: number,
): boolean {
  if (stage === Stage.TOB_SOTETSEG) {
    // Sotetseg's maze teleports players from their location in the room to a
    // specific start tile in the overworld or underworld.
    if (ticks !== 1) {
      return false;
    }

    const isTargetTile =
      (current.x === SOTETSEG_OVERWORLD_MAZE_START_TILE.x &&
        current.y === SOTETSEG_OVERWORLD_MAZE_START_TILE.y) ||
      (current.x === SOTETSEG_UNDERWORLD_MAZE_START_TILE.x &&
        current.y === SOTETSEG_UNDERWORLD_MAZE_START_TILE.y);
    if (!isTargetTile) {
      return false;
    }

    return (
      last.x >= SOTETSEG_ROOM_AREA.x &&
      last.x <= SOTETSEG_ROOM_AREA.x + SOTETSEG_ROOM_AREA.width &&
      last.y >= SOTETSEG_ROOM_AREA.y &&
      last.y <= SOTETSEG_ROOM_AREA.y + SOTETSEG_ROOM_AREA.height
    );
  }

  return false;
}
