import {
  Attack,
  Challenge,
  ChallengeType,
  ColosseumChallenge,
  Coords,
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
  Skill,
  VerzikHealEvent,
  VerzikDawnEvent,
} from '@blert/common';
import { useSearchParams } from 'next/navigation';
import {
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { ChallengeContext } from '@/challenge-context';
import { simpleItemCache } from './item-cache/simple';
import { TICK_MS } from './tick';
import { challengeApiUrl } from './url';

export const useLegacyTickTimeout = (
  enabled: boolean,
  playing: boolean,
  advanceTick: () => void,
  setTick: (tick: number | SetStateAction<number>) => void,
) => {
  const tickTimeout = useRef<number | undefined>(undefined);

  const clearTimeout = useCallback(() => {
    window.clearTimeout(tickTimeout.current);
    tickTimeout.current = undefined;
  }, []);

  const updateTickOnPage = useCallback(
    (tick: number | SetStateAction<number>) => {
      clearTimeout();
      setTick(tick);
    },
    [clearTimeout, setTick],
  );

  useEffect(() => {
    if (enabled && playing) {
      tickTimeout.current = window.setTimeout(() => {
        advanceTick();
      }, TICK_MS);
    } else {
      clearTimeout();
    }

    return () => clearTimeout();
  }, [advanceTick, enabled, playing, clearTimeout]);

  return {
    updateTickOnPage,
  };
};

export const usePlayingState = (totalTicks: number) => {
  const searchParams = useSearchParams();
  const initialTick = Number.parseInt(searchParams.get('tick') ?? '1', 10);

  const [currentTick, setTick] = useState(initialTick);
  const [playing, setPlaying] = useState(false);

  const advanceTick = useCallback(() => {
    setTick((tick) => {
      if (tick < totalTicks) {
        return tick + 1;
      }
      setPlaying(false);
      return 1;
    });
  }, [totalTicks]);

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setTick((tick) => Math.max(1, tick - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setTick((tick) => Math.min(totalTicks, tick + 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((playing) => !playing);
      }
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [totalTicks, setTick]);

  return {
    currentTick,
    advanceTick,
    setTick,
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
  skills: { [key in Skill]?: SkillLevel };
  customState: Array<CustomPlayerState>;
};

export type CustomPlayerState = {
  label: string;
  fullText?: string;
  icon?: string;
};

export type NpcState = {
  attack: Nullable<{ type: NpcAttack; target: string | null }>;
  position: Coords;
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
  const challengeRef = useRef(challenge);

  let { ticks: totalTicks } = getStageInfo(challengeRef.current, stage);
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
        const url = `${challengeApiUrl(c.type, c.uuid)}/events?stage=${stage}`;
        evts = await fetch(url).then((res) => res.json());
      } catch (e) {
        setEvents([]);
        setLoading(false);
        return;
      }

      setEvents(evts);

      if (evts.length > 0) {
        const { ticks, npcs } = getStageInfo(c, stage);
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
  }, [stage]);

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
  if (!isPlayerEvent(event)) {
    return false;
  }

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
  [EquipmentSlot.QUIVER]: null,
};

function computePlayerState(
  party: string[],
  totalTicks: number,
  eventsByTick: EventTickMap,
  eventsByType: EventTypeMap,
): Map<string, Nullable<PlayerState>[]> {
  let playerState: Map<string, Nullable<PlayerState>[]> = new Map();

  for (const partyMember of party) {
    const state: Array<Nullable<PlayerState>> = Array(totalTicks).fill(null);

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
          acc: true,
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
              ? { ...state[lastActiveTick]!.equipment }
              : { ...EMPTY_EQUIPMENT },
          skills: {},
          customState: [],
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

            if (rest.player.attack !== undefined) {
              playerStateThisTick!.skills[Skill.ATTACK] = SkillLevel.fromRaw(
                rest.player.attack,
              );
            }
            if (rest.player.defence !== undefined) {
              playerStateThisTick!.skills[Skill.DEFENCE] = SkillLevel.fromRaw(
                rest.player.defence,
              );
            }
            if (rest.player.strength !== undefined) {
              playerStateThisTick!.skills[Skill.STRENGTH] = SkillLevel.fromRaw(
                rest.player.strength,
              );
            }
            if (rest.player.hitpoints !== undefined) {
              playerStateThisTick!.skills[Skill.HITPOINTS] = SkillLevel.fromRaw(
                rest.player.hitpoints,
              );
            }
            if (rest.player.prayer !== undefined) {
              playerStateThisTick!.skills[Skill.PRAYER] = SkillLevel.fromRaw(
                rest.player.prayer,
              );
            }
            if (rest.player.ranged !== undefined) {
              playerStateThisTick!.skills[Skill.RANGED] = SkillLevel.fromRaw(
                rest.player.ranged,
              );
            }
            if (rest.player.magic !== undefined) {
              playerStateThisTick!.skills[Skill.MAGIC] = SkillLevel.fromRaw(
                rest.player.magic,
              );
            }

            playerStateThisTick = { ...playerStateThisTick!, ...rest };
          } else if (event.type === EventType.PLAYER_ATTACK) {
            const attack = (event as PlayerAttackEvent).attack;
            if (attack.weapon) {
              attack.weapon.name = simpleItemCache.getItemName(
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
          acc: true,
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
          skills: {},
          customState: [],
        };
      }

      state[tick] = playerStateThisTick;
    }

    postprocessPlayerState(partyMember, state, eventsByType);
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
        const itemName = simpleItemCache.getItemName(delta.getItemId());
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
          position: {
            x: eventsForThisNpc[0].xCoord,
            y: eventsForThisNpc[0].yCoord,
          },
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
            position: {
              x: eventsForThisNpc[0].xCoord,
              y: eventsForThisNpc[0].yCoord,
            },
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

function postprocessPlayerState(
  partyMember: string,
  state: Array<Nullable<PlayerState>>,
  eventsByType: EventTypeMap,
) {
  eventsByType[EventType.TOB_VERZIK_HEAL]?.forEach((event) => {
    const verzikHeal = (event as VerzikHealEvent).verzikHeal;
    const tickState = state[event.tick];
    if (tickState !== null && verzikHeal.player === partyMember) {
      tickState.customState.push({
        icon: '/images/npcs/8386.webp',
        label: verzikHeal.healAmount.toString(),
        fullText:
          verzikHeal.healAmount > 0
            ? `Healed Verzik for ${verzikHeal.healAmount}`
            : 'Healed Verzik',
      });
    }
  });

  eventsByType[EventType.TOB_VERZIK_DAWN]?.forEach((event) => {
    const dawn = (event as VerzikDawnEvent).verzikDawn;
    const tickState = state[dawn.attackTick];
    if (tickState !== null && dawn.player === partyMember) {
      tickState.customState.push({
        label: dawn.damage.toString(),
        fullText: `Dawnbringer special attack hit for ${dawn.damage}`,
      });
    }
  });
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
