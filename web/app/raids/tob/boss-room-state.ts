import {
  Attack,
  Event,
  EventType,
  NpcAttackEvent,
  Player,
  PlayerAttackEvent,
  PlayerEvent,
  PlayerUpdateEvent,
  Stage,
  TobRooms,
  isPlayerEvent,
} from '@blert/common';
import {
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { TICK_MS } from '../../utils/tick';
import { RaidContext } from './context';

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

export type EventTickMap = { [key: number]: Event[] };
export type EventTypeMap = { [key: string]: Event[] };
export type PlayerStateMap = Map<string, Nullable<PlayerState>[]>;

type EventState = {
  eventsByTick: EventTickMap;
  eventsByType: EventTypeMap;
  playerState: PlayerStateMap;
  bossAttackTimeline: NpcAttackEvent[];
};

export const useRoomEvents = (stage: Stage) => {
  const raidData = useContext(RaidContext);

  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventState, setEventState] = useState<EventState>({
    eventsByTick: {},
    eventsByType: {},
    playerState: new Map(),
    bossAttackTimeline: [],
  });

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

  let totalTicks = raidData?.tobRooms[room]?.roomTicks ?? -1;
  if (totalTicks === -1 && events.length > 0) {
    totalTicks = events[events.length - 1].tick;
  }

  useEffect(() => {
    if (raidData === null) {
      return;
    }

    setLoading(true);
    const getEvents = async () => {
      let evts: Event[] = [];

      try {
        evts = await fetch(
          `/api/v1/raids/tob/${raidData._id}/events?stage=${stage}`,
        ).then((res) => res.json());
      } catch (e) {
        setEvents([]);
        setLoading(false);
        return;
      }

      setEvents(evts);

      if (evts.length > 0) {
        totalTicks = raidData.tobRooms[room]?.roomTicks ?? -1;
        if (totalTicks === -1) {
          // The room is in progress, so get the last tick from the events.
          totalTicks = evts[evts.length - 1].tick;
        }

        const [eventsByTick, eventsByType] = buildEventMaps(evts);
        const playerState = computePlayerState(
          raidData.party,
          totalTicks,
          eventsByTick,
        );

        const eventState = {
          eventsByTick,
          eventsByType,
          playerState,
          bossAttackTimeline:
            (eventsByType[EventType.NPC_ATTACK] as NpcAttackEvent[]) ?? [],
        };

        setEventState(eventState);
      }

      setLoading(false);
    };

    getEvents();
  }, [raidData, stage]);

  return {
    raidData,
    events,
    totalTicks,
    loading,
    ...eventState,
  };
};

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

export type PlayerState = Omit<PlayerUpdateEvent, 'type' | 'stage' | 'cId'> & {
  attack?: Attack;
  diedThisTick: boolean;
  isDead: boolean;
};

type Nullable<T> = T | null;

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
