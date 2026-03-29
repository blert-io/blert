import {
  Challenge,
  ChallengeType,
  ColosseumChallenge,
  Coords,
  Event,
  InfernoChallenge,
  MokhaiotlChallenge,
  RoomNpcMap as RawRoomNpcMap,
  Skill,
  SkillLevel,
  SplitType,
  Stage,
  TobRaid,
  TobRooms,
} from '@blert/common';
import { useSearchParams } from 'next/navigation';
import {
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ChallengeContext } from '@/challenge-context';
import { AnyEntity, NpcEntity, PlayerEntity } from '@/components/map-renderer';
import { clamp } from '@/utils/math';

import { challengeApiUrl } from './url';

export * from './stage-state';

import {
  buildEventMaps,
  computeNpcState,
  computePlayerState,
  EventState,
  PlayerStateMap,
  RoomNpcMap,
  toBcf,
} from './stage-state';

export const usePlayingState = (totalTicks: number) => {
  const searchParams = useSearchParams();
  const initialTick = Number.parseInt(searchParams.get('tick') ?? '1', 10);
  const normalizedInitialTick = Number.isNaN(initialTick) ? 1 : initialTick;
  const maxTick = Math.max(1, totalTicks - 1);

  const [currentTick, setCurrentTick] = useState(() =>
    clamp(normalizedInitialTick, 1, maxTick),
  );
  const [playing, setPlaying] = useState(false);

  const setTick = useCallback(
    (tickOrUpdater: SetStateAction<number>) => {
      setCurrentTick((currentTick) => {
        const nextTick =
          typeof tickOrUpdater === 'number'
            ? tickOrUpdater
            : tickOrUpdater(currentTick);
        return clamp(Number.isNaN(nextTick) ? 1 : nextTick, 1, maxTick);
      });
    },
    [maxTick],
  );

  const advanceTick = useCallback(() => {
    setCurrentTick((tick) => {
      if (tick < maxTick) {
        return tick + 1;
      }
      setPlaying(false);
      return 1;
    });
  }, [maxTick]);

  useEffect(() => {
    setCurrentTick((tick) => clamp(tick, 1, maxTick));
  }, [maxTick]);

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setTick((tick) => tick - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setTick((tick) => tick + 1);
      } else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((playing) => !playing);
      }
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [setTick]);

  return {
    currentTick,
    advanceTick,
    setTick,
    playing,
    setPlaying,
  };
};

type StageInfo = {
  ticks: number;
  npcs: RawRoomNpcMap;
};

export function getStageInfo(
  challenge: Challenge | null,
  stage: Stage,
  attempt?: number,
): StageInfo {
  if (challenge === null) {
    return { ticks: -1, npcs: {} };
  }

  if (challenge.type === ChallengeType.TOB) {
    const raid = challenge as TobRaid;
    let room: keyof TobRooms = 'maiden';
    let split: SplitType;
    switch (stage) {
      case Stage.TOB_MAIDEN:
        room = 'maiden';
        split = SplitType.TOB_MAIDEN;
        break;
      case Stage.TOB_BLOAT:
        room = 'bloat';
        split = SplitType.TOB_BLOAT;
        break;
      case Stage.TOB_NYLOCAS:
        room = 'nylocas';
        split = SplitType.TOB_NYLO_ROOM;
        break;
      case Stage.TOB_SOTETSEG:
        room = 'sotetseg';
        split = SplitType.TOB_SOTETSEG;
        break;
      case Stage.TOB_XARPUS:
        room = 'xarpus';
        split = SplitType.TOB_XARPUS;
        break;
      case Stage.TOB_VERZIK:
        room = 'verzik';
        split = SplitType.TOB_VERZIK_ROOM;
        break;
    }

    return {
      ticks: challenge.splits[split!] ?? -1,
      npcs: raid.tobRooms[room]?.npcs ?? {},
    };
  }

  if (challenge.type === ChallengeType.COLOSSEUM) {
    const colosseum = challenge as ColosseumChallenge;
    const waveIndex = stage - Stage.COLOSSEUM_WAVE_1;
    const split: SplitType = SplitType.COLOSSEUM_WAVE_1 + waveIndex;
    return {
      ticks: challenge.splits[split] ?? -1,
      npcs: colosseum.colosseum.waves[waveIndex]?.npcs ?? {},
    };
  }

  if (challenge.type === ChallengeType.INFERNO) {
    const inferno = challenge as InfernoChallenge;
    const waveIndex = stage - Stage.INFERNO_WAVE_1;
    return {
      ticks: inferno.inferno.waves[waveIndex]?.ticks ?? -1,
      npcs: inferno.inferno.waves[waveIndex]?.npcs ?? {},
    };
  }

  if (challenge.type === ChallengeType.MOKHAIOTL) {
    const mokhaiotl = challenge as MokhaiotlChallenge;
    let delveIndex;
    if (attempt !== undefined) {
      delveIndex = attempt + 7;
    } else {
      delveIndex = stage - Stage.MOKHAIOTL_DELVE_1;
    }
    return {
      ticks: mokhaiotl.mokhaiotl.delves[delveIndex]?.challengeTicks ?? -1,
      npcs: mokhaiotl.mokhaiotl.delves[delveIndex]?.npcs ?? {},
    };
  }

  return { ticks: -1, npcs: {} };
}

export function useStageEvents<T extends Challenge>(
  stage: Stage,
  attempt?: number,
) {
  const [challenge] = useContext(ChallengeContext) as [T | null, unknown];

  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventState, setEventState] = useState<EventState>({
    eventsByTick: {},
    eventsByType: {},
    playerState: new Map(),
    npcState: new Map(),
    bcf: {
      version: '1.0',
      name: '',
      description: '',
      config: { totalTicks: 0, rowOrder: [], startTick: 0 },
      timeline: { actors: [], ticks: [] },
    },
  });
  const challengeRef = useRef(challenge);

  let { ticks: totalTicks } = getStageInfo(
    challengeRef.current,
    stage,
    attempt,
  );
  if (totalTicks === -1 && events.length > 0) {
    totalTicks = events[events.length - 1].tick;
  }

  useEffect(() => {
    challengeRef.current = challenge;
  }, [challenge]);

  useEffect(() => {
    const c = challengeRef.current;
    if (c === null) {
      return;
    }

    setLoading(true);
    const getEvents = async () => {
      let evts: Event[] = [];

      try {
        const url = `${challengeApiUrl(c.type, c.uuid)}/events?stage=${stage}${
          attempt !== undefined ? `&attempt=${attempt}` : ''
        }`;
        evts = (await fetch(url).then((res) => res.json())) as Event[];
      } catch {
        setEvents([]);
        setLoading(false);
        return;
      }

      setEvents(evts);

      if (evts.length > 0) {
        const { ticks, npcs } = getStageInfo(c, stage, attempt);
        let totalTicks = ticks;
        if (totalTicks === -1) {
          // The room is in progress, so get the last tick from the events.
          totalTicks = evts[evts.length - 1].tick;
        }

        const [eventsByTick, eventsByType] = buildEventMaps(evts);
        const playerState = computePlayerState(
          c.party.map((p) => p.username),
          totalTicks,
          eventsByTick,
          eventsByType,
        );
        const npcState = computeNpcState(
          npcs,
          totalTicks,
          eventsByTick,
          eventsByType,
        );

        setEventState({
          eventsByTick,
          eventsByType,
          playerState,
          npcState,
          bcf: toBcf(
            c,
            stage,
            totalTicks,
            eventsByTick,
            eventsByType,
            playerState,
            npcState,
          ),
        });
      }

      setLoading(false);
    };

    void getEvents();
  }, [stage, attempt]);

  return {
    challenge,
    events,
    totalTicks,
    loading,
    isLive: false,
    isStreaming: false,
    ...eventState,
  };
}

type CustomEntitiesCallback = (tick: number) => AnyEntity[];
type ModifyEntityCallback = (tick: number, entity: AnyEntity) => AnyEntity;

type CustomEntitiesOptions = {
  customEntitiesForTick?: CustomEntitiesCallback;
  modifyEntity?: ModifyEntityCallback;
};

function buildEntitiesForTick(
  tick: number,
  totalTicks: number,
  partyOrb: Record<string, number>,
  playerState: PlayerStateMap,
  npcState: RoomNpcMap,
  preloads: Set<string>,
  modifyEntity: ModifyEntityCallback,
  customEntitiesForTick: CustomEntitiesCallback,
): AnyEntity[] {
  const entitiesForTick: AnyEntity[] = [];

  for (const [playerName, state] of playerState) {
    const ps = state?.at(tick);
    if (!ps) {
      continue;
    }

    const orb = partyOrb[playerName] ?? 7;

    let nextPosition: Coords | undefined = undefined;
    let nextHitpoints: SkillLevel | undefined = undefined;
    if (tick < totalTicks - 1) {
      const nextState = state?.at(tick + 1);
      if (nextState) {
        nextPosition = { x: nextState.xCoord, y: nextState.yCoord };
        nextHitpoints = nextState.skills[Skill.HITPOINTS];
      }
    }

    const playerEntity = new PlayerEntity(
      { x: ps.xCoord, y: ps.yCoord },
      playerName,
      orb,
      { current: ps.skills[Skill.HITPOINTS], next: nextHitpoints },
      nextPosition,
    );

    entitiesForTick.push(modifyEntity(tick, playerEntity));
  }

  for (const [roomId, npc] of npcState) {
    const ns = npc.stateByTick[tick];
    if (!ns) {
      continue;
    }

    let nextPosition: Coords | undefined = undefined;
    let nextHitpoints: SkillLevel | undefined = undefined;
    if (tick < totalTicks - 1) {
      const nextState = npc.stateByTick[tick + 1];
      if (nextState) {
        nextPosition = nextState.position;
        nextHitpoints = nextState.hitpoints;
      }
    }

    let npcEntity = new NpcEntity(
      ns.position,
      ns.id,
      roomId,
      { current: ns.hitpoints, next: nextHitpoints },
      ns.prayers,
      nextPosition,
    );

    npcEntity = modifyEntity(tick, npcEntity) as NpcEntity;
    preloads.add(npcEntity.imageUrl);
    entitiesForTick.push(npcEntity);
  }

  entitiesForTick.push(...customEntitiesForTick(tick));

  return entitiesForTick;
}

/**
 * Returns a function that builds entities for a given tick in a stage, plus
 * accumulated preload entity sprite URLs.
 *
 * @param challenge Challenge to which the stage belongs.
 * @param playerState Player state for the stage.
 * @param npcState NPC state for the stage.
 * @param totalTicks Total number of ticks in the stage.
 * @param options Options to configure the entities.
 * @returns A function that builds entities for a given tick.
 */
export function useMapEntities(
  challenge: Challenge | null,
  playerState: PlayerStateMap,
  npcState: RoomNpcMap,
  totalTicks: number,
  options: CustomEntitiesOptions = {},
): { getEntities: (tick: number) => AnyEntity[]; preloads: string[] } {
  const { customEntitiesForTick = () => [], modifyEntity = (_, e) => e } =
    options;

  const preloadSet = useRef(new Set<string>());

  const partyOrb = useMemo(() => {
    if (challenge === null) {
      return {};
    }
    return challenge.party.reduce(
      (acc, p, i) => {
        acc[p.username] = i;
        return acc;
      },
      {} as Record<string, number>,
    );
  }, [challenge]);

  const getEntities = useCallback(
    (tick: number): AnyEntity[] => {
      if (challenge === null || tick < 0 || tick >= totalTicks) {
        return [];
      }
      return buildEntitiesForTick(
        tick,
        totalTicks,
        partyOrb,
        playerState,
        npcState,
        preloadSet.current,
        modifyEntity,
        customEntitiesForTick,
      );
    },
    [
      challenge,
      totalTicks,
      partyOrb,
      playerState,
      npcState,
      modifyEntity,
      customEntitiesForTick,
    ],
  );

  const preloads = useMemo(
    () => Array.from(preloadSet.current),
    // `preloadSet` is populated whenever `getEntities` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getEntities],
  );

  return { getEntities, preloads };
}
