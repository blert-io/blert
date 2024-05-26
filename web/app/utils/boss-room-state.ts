import {
  Attack,
  Challenge,
  ChallengeType,
  ColosseumChallenge,
  EquipmentSlot,
  Event,
  EventType,
  ItemDelta,
  Npc,
  NpcAttack,
  NpcAttackEvent,
  NpcEvent,
  PlayerAttackEvent,
  PlayerEvent,
  PlayerUpdateEvent,
  RoomNpc,
  RoomNpcMap as RawRoomNpcMap,
  SkillLevel,
  Stage,
  TobRaid,
  TobRooms,
  isNpcEvent,
  isPlayerEvent,
  RawItemDelta,
  MaidenCrabProperties,
  NyloProperties,
  VerzikCrabProperties,
  DataSource,
  SplitType,
} from '@blert/common';
import {
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { ChallengeContext } from '@/challenge-context';
import { defaultItemCache } from './item-cache';
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
  }, [currentTick, totalTicks, playing, updateTickOnPage]);

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') {
        return;
      }

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

export type EnhancedMaidenCrab = EnhancedRoomNpc & {
  maidenCrab: MaidenCrabProperties;
};

export type EnhancedNylo = EnhancedRoomNpc & {
  nylo: NyloProperties;
};

export type EnhancedVerzikCrab = EnhancedRoomNpc & {
  verzikCrab: VerzikCrabProperties;
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

type Item = {
  id: number;
  name: string;
  quantity: number;
};

export type PlayerEquipment = {
  [slot in EquipmentSlot]: Item | null;
};

export type PlayerState = Omit<PlayerUpdateEvent, 'type' | 'stage' | 'cId'> & {
  attack?: Attack;
  diedThisTick: boolean;
  isDead: boolean;
  equipment: PlayerEquipment;
};

export type NpcState = {
  attack: Nullable<{ type: NpcAttack; target: string | null }>;
  hitpoints: SkillLevel;
  label?: string;
};

type StageInfo = {
  ticks: number;
  npcs: RawRoomNpcMap;
};

function getStageInfo(challenge: Challenge | null, stage: Stage): StageInfo {
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

  return { ticks: -1, npcs: {} };
}

export function useStageEvents<T extends Challenge>(stage: Stage) {
  const [challenge] = useContext(ChallengeContext) as [T | null, unknown];

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
        const url = `${challengeApiUrl(challenge.type, challenge.uuid)}/events?stage=${stage}`;
        evts = await fetch(url).then((res) => res.json());
      } catch (e) {
        setEvents([]);
        setLoading(false);
        return;
      }

      setEvents(evts);

      if (evts.length > 0) {
        const { ticks, npcs } = getStageInfo(challenge, stage);
        let totalTicks = ticks;
        if (totalTicks === -1) {
          // The room is in progress, so get the last tick from the events.
          totalTicks = evts[evts.length - 1].tick;
        }

        const [eventsByTick, eventsByType] = buildEventMaps(evts);
        const playerState = computePlayerState(
          challenge.party.map((p) => p.username),
          totalTicks,
          eventsByTick,
        );
        const npcState = computeNpcState(
          npcs,
          totalTicks,
          eventsByTick,
          eventsByType,
        );

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

const EMPTY_EQUIPMENT: PlayerEquipment = {
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
};

function computePlayerState(
  party: string[],
  totalTicks: number,
  eventsByTick: EventTickMap,
): Map<string, Nullable<PlayerState>[]> {
  let playerState: Map<string, Nullable<PlayerState>[]> = new Map();

  for (const partyMember of party) {
    const state = Array(totalTicks).fill(null);

    let isDead = false;
    let lastActiveTick = -1;

    for (let tick = 0; tick < totalTicks; tick++) {
      const eventsForThisTick = eventsByTick[tick];
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
          tick,
          player: {
            source: DataSource.SECONDARY,
            name: partyMember,
            offCooldownTick: 0,
            prayerSet: 0,
          },
          diedThisTick: false,
          isDead,
          equipment:
            lastActiveTick !== -1
              ? { ...state[lastActiveTick].equipment }
              : { ...EMPTY_EQUIPMENT },
        };
        lastActiveTick = tick;

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

            if (rest.player.equipmentDeltas) {
              applyItemDeltas(
                playerStateThisTick!.equipment,
                rest.player.equipmentDeltas,
              );
            }

            playerStateThisTick = { ...playerStateThisTick!, ...rest };
          } else if (event.type === EventType.PLAYER_ATTACK) {
            const attack = (event as PlayerAttackEvent).attack;
            if (attack.weapon) {
              attack.weapon.name = defaultItemCache.getItemName(
                attack.weapon.id,
              );
            }
            playerStateThisTick = {
              ...playerStateThisTick!,
              attack,
            };
          }
        });
      } else if (isDead) {
        playerStateThisTick = {
          xCoord: 0,
          yCoord: 0,
          tick,
          player: {
            source: DataSource.SECONDARY,
            name: partyMember,
            offCooldownTick: 0,
            prayerSet: 0,
          },
          diedThisTick: false,
          isDead: true,
          equipment: { ...EMPTY_EQUIPMENT },
        };
      }

      state[tick] = playerStateThisTick;
    }

    playerState.set(partyMember, state);
  }

  return playerState;
}

/**
 * Applies the equipment changes specified by `deltas` in-place to the
 * `equipment` object.
 * @param equipment The equipment object to apply the deltas to.
 * @param rawDeltas List of deltas to apply.
 */
function applyItemDeltas(
  equipment: PlayerEquipment,
  rawDeltas: RawItemDelta[],
): void {
  for (const rawDelta of rawDeltas) {
    const delta = ItemDelta.fromRaw(rawDelta);
    const previousItem = equipment[delta.getSlot()];

    if (delta.isAdded()) {
      if (previousItem === null || previousItem.id !== delta.getItemId()) {
        const itemName = defaultItemCache.getItemName(delta.getItemId());
        equipment[delta.getSlot()] = {
          id: delta.getItemId(),
          name: itemName,
          quantity: delta.getQuantity(),
        };
      } else {
        equipment[delta.getSlot()] = {
          id: previousItem.id,
          name: previousItem.name,
          quantity: previousItem.quantity + delta.getQuantity(),
        };
      }
    } else {
      if (
        previousItem !== null &&
        previousItem!.quantity - delta.getQuantity() > 0
      ) {
        equipment[delta.getSlot()] = {
          ...previousItem!,
          quantity: previousItem!.quantity - delta.getQuantity(),
        };
      } else {
        equipment[delta.getSlot()] = null;
      }
    }
  }
}

function computeNpcState(
  roomNpcs: RawRoomNpcMap,
  totalTicks: number,
  eventsByTick: EventTickMap,
  eventsByType: EventTypeMap,
): RoomNpcMap {
  const npcs: RoomNpcMap = new Map();

  Object.entries(roomNpcs).forEach(([roomId, roomNpc]) => {
    const npc: EnhancedRoomNpc = {
      ...roomNpc,
      stateByTick: new Array(totalTicks).fill(null),
      hasAttacks: false,
    };

    let lastActiveTick = -1;

    for (let i = 0; i < totalTicks; i++) {
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
        lastActiveTick = i;
      }

      const attackEvent = eventsForThisTick.find(
        (e) =>
          e.type === EventType.NPC_ATTACK &&
          (e as NpcAttackEvent).npc.roomId === Number(roomId),
      ) as NpcAttackEvent | undefined;
      if (attackEvent !== undefined) {
        if (npc.stateByTick[i] === null) {
          const hitpoints =
            lastActiveTick !== -1
              ? npc.stateByTick[lastActiveTick]!.hitpoints
              : new SkillLevel(0, 1);
          npc.stateByTick[i] = {
            attack: null,
            hitpoints,
          };
        }

        npc.hasAttacks = true;
        npc.stateByTick[i]!.attack = {
          type: attackEvent.npcAttack.attack,
          target: attackEvent.npcAttack.target ?? null,
        };
      }
    }

    postprocessNpcs(npc, eventsByType);
    npcs.set(Number(roomId), npc);
  });

  return npcs;
}

const BLOAT_DOWN_TICKS = 32;

function postprocessNpcs(npc: EnhancedRoomNpc, eventsByType: EventTypeMap) {
  if (Npc.isBloat(npc.spawnNpcId)) {
    eventsByType[EventType.TOB_BLOAT_DOWN]?.forEach((event) => {
      const lastDownTick = Math.min(
        event.tick + BLOAT_DOWN_TICKS,
        npc.stateByTick.length - 1,
      );
      for (let i = event.tick; i <= lastDownTick; i++) {
        if (npc.stateByTick[i] !== null) {
          const downTick = BLOAT_DOWN_TICKS - (i - event.tick);
          npc.stateByTick[i]!.label = downTick.toString();
        }
      }
    });
    return;
  }
}
