import {
  Event,
  EventType,
  NpcAttackEvent,
  PlayerAttackEvent,
  PlayerEvent,
  PlayerUpdateEvent,
  Room,
  isPlayerEvent,
} from '@blert/common';
import {
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { TICK_MS } from '../../utils/tick';
import { RaidContext } from './context';
import { loadEventsForRoom } from '../../actions/raid';
import { PlayerDetails } from '../../components/boss-page-replay';
import { set } from 'mongoose';

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

type EventState = {
  eventsByTick: EventTickMap;
  eventsByType: EventTypeMap;
  playerAttackTimelines: Map<string, any>;
  bossAttackTimeline: NpcAttackEvent[];
};

export const useRoomEvents = (room: Room) => {
  const raidData = useContext(RaidContext);

  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventState, setEventState] = useState<EventState>({
    eventsByTick: {},
    eventsByType: {},
    playerAttackTimelines: new Map(),
    bossAttackTimeline: [],
  });

  let totalTicks = raidData?.rooms[room]?.roomTicks ?? -1;

  useEffect(() => {
    if (raidData === null) {
      return;
    }

    setLoading(true);
    const getEvents = async () => {
      const evts = await loadEventsForRoom(raidData._id, room);
      setEvents(evts);

      if (totalTicks === -1) {
        if (events.length > 0) {
          totalTicks = events[events.length - 1].tick;
        } else {
          totalTicks = 1;
        }
      }

      totalTicks = raidData.rooms[room]?.roomTicks ?? -1;

      const [eventsByTick, eventsByType] = buildEventMaps(evts);
      const playerAttackTimelines = buildAttackTimelines(
        raidData.party,
        totalTicks,
        eventsByTick,
      );

      const eventState = {
        eventsByTick,
        eventsByType,
        playerAttackTimelines,
        bossAttackTimeline:
          (eventsByType[EventType.NPC_ATTACK] as NpcAttackEvent[]) ?? [],
      };

      setEventState(eventState);
      setLoading(false);
    };

    getEvents();
  }, [raidData, room]);

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

function buildAttackTimelines(
  party: string[],
  totalTicks: number,
  eventsByTick: EventTickMap,
) {
  let attackTimelines: Map<string, any[]> = new Map();

  for (const partyMember of party) {
    attackTimelines.set(partyMember, new Array(totalTicks));

    let isDead = false;

    for (let i = 0; i < totalTicks; i++) {
      const eventsForThisTick = eventsByTick[i];
      if (eventsForThisTick === undefined) {
        continue;
      }

      const eventsForThisPlayer = eventsForThisTick.filter((event) =>
        eventBelongsToPlayer(event, partyMember),
      );
      let combinedEventsForThisTick = null;

      if (eventsForThisPlayer.length > 0) {
        combinedEventsForThisTick = eventsForThisPlayer.reduce((acc, event) => {
          if (event.type === EventType.PLAYER_DEATH) {
            isDead = true;

            return {
              ...acc,
              tick: i,
              player: { name: partyMember },
              diedThisTick: isDead,
              isDead,
            };
          }

          if (event.type === EventType.PLAYER_UPDATE) {
            const { type, room, raidId, ...rest } = event;
            return { ...acc, ...rest, isDead };
          }

          if (event.type === EventType.PLAYER_ATTACK) {
            return {
              ...acc,
              tick: i,
              attack: (event as PlayerAttackEvent).attack,
            };
          }

          return acc;
        }, {});
      } else if (isDead) {
        combinedEventsForThisTick = {
          tick: i,
          player: { name: partyMember },
          isDead: true,
        };
      }

      attackTimelines.get(partyMember)![i] = combinedEventsForThisTick;
    }
  }

  if (
    Array.from(attackTimelines.values()).every(
      (value) => value.length === totalTicks,
    )
  ) {
    // console.log(`All timelines are ${totalTicks} ticks long (good!)`);
  } else {
    console.error('Not all timelines are the same length, this is bad.');
    window.location.href = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  }

  return attackTimelines;
}

/**
 * Collects information for each player in the raid at a given tick.
 * TODO(frolv): Try to consolidate this with the code in `buildAttackTimelines`.
 *
 * @param playerEventsForTick All player events for a given tick.
 * @returns Details about each player.
 */
export function getPlayerDetails(
  party: string[],
  playerEventsForTick: PlayerEvent[],
): PlayerDetails {
  const playerDetails: PlayerDetails = {};
  for (const username of party) {
    playerDetails[username] = {};
  }

  playerEventsForTick
    .filter((evt) => evt.type === EventType.PLAYER_UPDATE)
    .forEach((evt) => {
      const e = evt as PlayerUpdateEvent;

      playerDetails[e.player.name] = {
        equipment: e.player.equipment ?? {},
      };
    });

  return playerDetails;
}
