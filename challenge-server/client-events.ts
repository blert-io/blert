import {
  DataSource,
  EquipmentSlot,
  ItemDelta,
  SkillLevel,
  StageStatus,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import logger from './log';
import { ChallengeInfo } from './merge';
import { stat } from 'fs';

export class ClientEvents {
  private readonly finalTick: number;
  private readonly tickState: TickState[];
  private readonly accurate: boolean;
  private readonly primaryPlayer: string | null;

  public static fromRawEvents(
    challenge: ChallengeInfo,
    rawEvents: Event[],
  ): ClientEvents {
    const events = [...rawEvents].sort((a, b) => a.getTick() - b.getTick());
    const lastTick = events[events.length - 1].getTick();
    let accurate = false;

    const primaryPlayers = new Set<string>();

    const eventsByTick: Array<Event[]> = Array(lastTick + 1).fill([]);
    events.forEach((event) => {
      if (event.getType() === Event.Type.STAGE_UPDATE) {
        const stageUpdate = event.getStageUpdate()!;
        const isEnd =
          stageUpdate.getStatus() === StageStatus.COMPLETED ||
          stageUpdate.getStatus() === StageStatus.WIPED;
        if (isEnd) {
          accurate = stageUpdate.getAccurate();
        }
      } else {
        if (
          event.getType() === Event.Type.PLAYER_UPDATE &&
          event.getPlayer()!.getDataSource() === DataSource.PRIMARY
        ) {
          primaryPlayers.add(event.getPlayer()!.getName());
        }

        eventsByTick[event.getTick()] = [
          ...eventsByTick[event.getTick()],
          event,
        ];
      }
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

    return new ClientEvents(tickState, accurate, primaryPlayer);
  }

  /**
   * @returns The highest recorded tick in the client events.
   */
  public getFinalTick(): number {
    return this.finalTick;
  }

  /**
   * @returns Whether the recorded ticks of the client's events are accurate.
   */
  public areAccurate(): boolean {
    return this.accurate;
  }

  /**
   * Returns all events that occurred at the given tick.
   * @param tick The tick whose events to retrieve.
   * @returns Possibly empty array of events that were recorded.
   */
  public getTickState(tick: number): TickState {
    return this.tickState[tick];
  }

  /**
   * @returns Whether this client recorded data without being a participant.
   */
  public isSpectator(): boolean {
    return this.primaryPlayer === null;
  }

  private constructor(
    tickState: TickState[],
    accurate: boolean,
    primaryPlayer: string | null,
  ) {
    this.tickState = tickState;
    this.finalTick = tickState.length - 1;
    this.accurate = accurate;
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
        let state: PlayerState = {
          username: player,
          x: lastState?.x ?? 0,
          y: lastState?.y ?? 0,
          isDead,
          equipment: lastState?.equipment ?? {
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

        const events = eventsByTick[tick]?.filter(
          (event) =>
            (event.getType() === Event.Type.PLAYER_UPDATE ||
              event.getType() === Event.Type.PLAYER_DEATH) &&
            event.getPlayer()?.getName() === player,
        );

        if (!events || events.length === 0) {
          continue;
        }

        events.forEach((event) => {
          switch (event.getType()) {
            case Event.Type.PLAYER_UPDATE: {
              state.x = event.getXCoord();
              state.y = event.getYCoord();

              const player = event.getPlayer()!;
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
                    previous.quantity += delta.getQuantity();
                  }
                } else {
                  if (previous !== null && previous.id === delta.getItemId()) {
                    previous.quantity -= delta.getQuantity();
                    if (previous.quantity <= 0) {
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

type NpcState = {
  x: number;
  y: number;
  hitpoints: number;
};

type EquippedItem = {
  id: number;
  quantity: number;
};

type PlayerState = {
  username: string;
  x: number;
  y: number;
  isDead: boolean;
  equipment: {
    [slot in EquipmentSlot]: EquippedItem | null;
  };
};

export class TickState {
  private readonly tick: number;
  private readonly events: Event[];
  private readonly npcs: Map<number, NpcState>;
  private readonly playerStates: Record<string, PlayerState | null>;

  public constructor(
    tick: number,
    events: Event[],
    playerStates: Record<string, PlayerState | null>,
  ) {
    this.tick = tick;
    this.events = events;
    this.playerStates = playerStates;

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
   * @returns Whether there are events recorded on this tick.
   */
  public hasEvents(): boolean {
    return this.events.length > 0;
  }

  /**
   * @returns All events recorded on this tick.
   */
  public getEvents(): Event[] {
    return this.events;
  }

  public getPlayerState(player: string): PlayerState | null {
    return this.playerStates[player] ?? null;
  }
}
