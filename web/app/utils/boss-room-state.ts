import {
  Attack,
  ChallengeType,
  ColosseumChallenge,
  Event,
  EventType,
  NpcAttackEvent,
  PlayerAttackEvent,
  PlayerEvent,
  PlayerUpdateEvent,
  Raid,
  RoomNpc,
  RoomNpcMap as RawRoomNpcMap,
  SkillLevel,
  Stage,
  TobRaid,
  TobRooms,
  isPlayerEvent,
  NpcEvent,
  isNpcEvent,
  NpcAttack,
  Npc,
} from '@blert/common';
import {
  Context,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { TICK_MS } from './tick';
import { challengeApiUrl } from './url';

export const usePlayingState = (totalTicks: number) => {
  const [currentTick, setTick] = useState(1);
  const [playing, setPlaying] = useState(false);

  const tickTimeout = useRef<number | undefined>(undefined);

  const clearTimeout = () => {
    window.clearTimeout(tickTimeout.current);
    tickTimeout.current = undefined;
  };

  const updateTickOnPage = useCallback(
    (tick: number | SetStateAction<number>) => {
      clearTimeout();
      setTick(tick);
    },
    [],
  );

  useEffect(() => {
    if (playing) {
      if (currentTick < totalTicks) {
        tickTimeout.current = window.setTimeout(() => {
          updateTickOnPage(currentTick + 1);
        }, TICK_MS);
      } else {
        setPlaying(false);
        clearTimeout();
        updateTickOnPage(1);
      }
    } else {
      clearTimeout();
    }
  }, [currentTick, totalTicks, playing]);

  useEffect(() => {
    const listener = (e: any) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        updateTickOnPage((tick) => Math.max(1, tick - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        updateTickOnPage((tick) => Math.min(totalTicks, tick + 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((playing) => !playing);
      }
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [totalTicks, updateTickOnPage]);

  return {
    currentTick,
    updateTickOnPage,
    playing,
    setPlaying,
  };
};

export type EnhancedRoomNpc = RoomNpc & {
  stateByTick: Nullable<NpcState>[];
  hasAttacks: boolean;
};

export type EventTickMap = { [key: number]: Event[] };
export type EventTypeMap = { [key: string]: Event[] };
export type PlayerStateMap = Map<string, Nullable<PlayerState>[]>;
export type RoomNpcMap = Map<number, EnhancedRoomNpc>;

type EventState = {
  eventsByTick: EventTickMap;
  eventsByType: EventTypeMap;
  playerState: PlayerStateMap;
  npcState: RoomNpcMap;
};

type Nullable<T> = T | null;

export type PlayerState = Omit<PlayerUpdateEvent, 'type' | 'stage' | 'cId'> & {
  attack?: Attack;
  diedThisTick: boolean;
  isDead: boolean;
};

export type NpcState = {
  attack: Nullable<{ type: NpcAttack; target: string | null }>;
  hitpoints: SkillLevel;
};

type StageInfo = {
  ticks: number;
  npcs: RawRoomNpcMap;
};

function getStageInfo(challenge: Raid | null, stage: Stage): StageInfo {
  if (challenge === null) {
    return { ticks: -1, npcs: {} };
  }

  if (challenge.type === ChallengeType.TOB) {
    const raid = challenge as TobRaid;
    let room: keyof TobRooms = 'maiden';
    switch (stage) {
      case Stage.TOB_MAIDEN:
        room = 'maiden';
        break;
      case Stage.TOB_BLOAT:
        room = 'bloat';
        break;
      case Stage.TOB_NYLOCAS:
        room = 'nylocas';
        break;
      case Stage.TOB_SOTETSEG:
        room = 'sotetseg';
        break;
      case Stage.TOB_XARPUS:
        room = 'xarpus';
        break;
      case Stage.TOB_VERZIK:
        room = 'verzik';
        break;
    }

    return {
      ticks: raid.tobRooms[room]?.roomTicks ?? -1,
      npcs: raid.tobRooms[room]?.npcs ?? {},
    };
  }

  if (challenge.type === ChallengeType.COLOSSEUM) {
    const colosseum = challenge as ColosseumChallenge;
    const waveIndex = stage - Stage.COLOSSEUM_WAVE_1;
    return {
      ticks: colosseum.colosseum.waves[waveIndex]?.ticks ?? -1,
      npcs: colosseum.colosseum.waves[waveIndex]?.npcs ?? {},
    };
  }

  return { ticks: -1, npcs: {} };
}

export function useRoomEvents<T extends Raid>(
  context: Context<T | null>,
  stage: Stage,
) {
  const challenge = useContext(context);

  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventState, setEventState] = useState<EventState>({
    eventsByTick: {},
    eventsByType: {},
    playerState: new Map(),
    npcState: new Map(),
  });

  let { ticks: totalTicks } = getStageInfo(challenge, stage);
  if (totalTicks === -1 && events.length > 0) {
    totalTicks = events[events.length - 1].tick;
  }

  useEffect(() => {
    if (challenge === null) {
      return;
    }

    setLoading(true);
    const getEvents = async () => {
      let evts: Event[] = [];

      try {
        const url = `${challengeApiUrl(challenge.type, challenge._id)}/events?stage=${stage}`;
        evts = await fetch(url).then((res) => res.json());
      } catch (e) {
        setEvents([]);
        setLoading(false);
        return;
      }

      setEvents(evts);

      if (evts.length > 0) {
        const { ticks, npcs } = getStageInfo(challenge, stage);
        totalTicks = ticks;
        if (totalTicks === -1) {
          // The room is in progress, so get the last tick from the events.
          totalTicks = evts[evts.length - 1].tick;
        }

        const [eventsByTick, eventsByType] = buildEventMaps(evts);
        const playerState = computePlayerState(
          challenge.party,
          totalTicks,
          eventsByTick,
        );
        const npcState = computeNpcState(npcs, totalTicks, eventsByTick);

        const eventState = {
          eventsByTick,
          eventsByType,
          playerState,
          npcState,
        };

        setEventState(eventState);
      }

      setLoading(false);
    };

    getEvents();
  }, [challenge, stage]);

  return {
    challenge,
    events,
    totalTicks,
    loading,
    ...eventState,
  };
}

function buildEventMaps(events: Event[]): [EventTickMap, EventTypeMap] {
  let byTick: EventTickMap = {};
  let byType: EventTypeMap = {};

  for (const event of events) {
    if (byTick[event.tick] === undefined) {
      byTick[event.tick] = [];
    }
    byTick[event.tick].push(event);

    if (byType[event.type] === undefined) {
      byType[event.type] = [];
    }
    byType[event.type].push(event);
  }

  return [byTick, byType];
}

const eventBelongsToPlayer = (event: Event, playerName: string): boolean => {
  if (!isPlayerEvent(event)) return false;

  const eventAsPlayerEvent = event as PlayerEvent;

  return eventAsPlayerEvent.player.name === playerName;
};

function computePlayerState(
  party: string[],
  totalTicks: number,
  eventsByTick: EventTickMap,
): Map<string, Nullable<PlayerState>[]> {
  let playerState: Map<string, Nullable<PlayerState>[]> = new Map();

  for (const partyMember of party) {
    playerState.set(partyMember, new Array(totalTicks).fill(null));

    let isDead = false;

    for (let i = 0; i < totalTicks; i++) {
      const eventsForThisTick = eventsByTick[i];
      if (eventsForThisTick === undefined) {
        continue;
      }

      const eventsForThisPlayer = eventsForThisTick.filter((event) =>
        eventBelongsToPlayer(event, partyMember),
      );
      let playerStateThisTick: PlayerState | null = null;

      if (eventsForThisPlayer.length > 0) {
        playerStateThisTick = {
          xCoord: 0,
          yCoord: 0,
          tick: i,
          player: { name: partyMember, offCooldownTick: 0, prayerSet: 0 },
          diedThisTick: false,
          isDead,
        };

        eventsForThisPlayer.forEach((event) => {
          if (event.type === EventType.PLAYER_DEATH) {
            isDead = true;
            playerStateThisTick = {
              ...playerStateThisTick!,
              diedThisTick: true,
              isDead,
            };
          } else if (event.type === EventType.PLAYER_UPDATE) {
            const { type, stage, ...rest } = event as PlayerUpdateEvent;
            playerStateThisTick = { ...playerStateThisTick!, ...rest };
          } else if (event.type === EventType.PLAYER_ATTACK) {
            playerStateThisTick = {
              ...playerStateThisTick!,
              attack: (event as PlayerAttackEvent).attack,
            };
          }
        });
      } else if (isDead) {
        playerStateThisTick = {
          xCoord: 0,
          yCoord: 0,
          tick: i,
          player: { name: partyMember, offCooldownTick: 0, prayerSet: 0 },
          diedThisTick: false,
          isDead: true,
        };
      }

      playerState.get(partyMember)![i] = playerStateThisTick;
    }
  }

  return playerState;
}

function computeNpcState(
  roomNpcs: RawRoomNpcMap,
  totalTicks: number,
  eventsByTick: EventTickMap,
): RoomNpcMap {
  const npcs: RoomNpcMap = new Map();

  Object.entries(roomNpcs).forEach(([roomId, roomNpc]) => {
    const npc: EnhancedRoomNpc = {
      ...roomNpc,
      stateByTick: new Array(totalTicks).fill(null),
      hasAttacks: false,
    };

    for (let i = roomNpc.spawnTick; i < roomNpc.deathTick; i++) {
      const eventsForThisTick = eventsByTick[i];
      if (eventsForThisTick === undefined) {
        continue;
      }

      const eventsForThisNpc = eventsForThisTick
        .filter<NpcEvent>(isNpcEvent)
        .filter((event) => event.npc.roomId === Number(roomId));

      if (eventsForThisNpc.length > 0) {
        npc.stateByTick[i] = {
          attack: null,
          hitpoints: SkillLevel.fromRaw(eventsForThisNpc[0].npc.hitpoints),
        };
      }

      const attackEvent = eventsForThisTick.find(
        (e) =>
          e.type === EventType.NPC_ATTACK &&
          (e as NpcAttackEvent).npc.roomId === Number(roomId),
      ) as NpcAttackEvent | undefined;
      if (attackEvent) {
        npc.hasAttacks = true;
        npc.stateByTick[i]!.attack = {
          type: attackEvent.npcAttack.attack,
          target: attackEvent.npcAttack.target ?? null,
        };
      }
    }

    postprocessNpcAttacks(npc);
    npcs.set(Number(roomId), npc);
  });

  return npcs;
}

function postprocessNpcAttacks(npc: EnhancedRoomNpc) {
  if (Npc.isManticore(npc.spawnNpcId)) {
    for (let i = 0; i < npc.stateByTick.length; i++) {
      const state = npc.stateByTick[i];
      if (state === null || state.attack === null) {
        continue;
      }

      // Add the manticore's second and third attacks to the timeline.
      i++;
      if (i < npc.stateByTick.length && npc.stateByTick[i] !== null) {
        const type =
          state.attack.type === NpcAttack.COLOSSEUM_MANTICORE_MAGE
            ? NpcAttack.COLOSSEUM_MANTICORE_RANGE
            : NpcAttack.COLOSSEUM_MANTICORE_MAGE;
        npc.stateByTick[i]!.attack = {
          type,
          target: state.attack.target,
        };
      }
      i++;
      if (i < npc.stateByTick.length && npc.stateByTick[i] !== null) {
        npc.stateByTick[i]!.attack = {
          type: NpcAttack.COLOSSEUM_MANTICORE_MELEE,
          target: state.attack.target,
        };
      }
    }
  }
}
