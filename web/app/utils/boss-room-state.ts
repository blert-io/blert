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
  PlayerAttack,
  PlayerSpell,
  PlayerUpdateEvent,
  RoomNpc,
  RoomNpcMap as RawRoomNpcMap,
  SkillLevel,
  Spell,
  SpellTarget,
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
  MokhaiotlChallenge,
  PrayerSet,
  InfernoChallenge,
  NpcId,
  NpcSpawnEvent,
  getNpcDefinition,
  NyloWaveSpawnEvent,
  XarpusPhase,
  VerzikPhase,
} from '@blert/common';
import type {
  BlertChartFormat,
  BCFActor,
  BCFTick,
  BCFCell,
  BCFAction,
  BCFPlayerState,
  BCFNpcPhaseAction,
  BCFPhase,
} from '@blert/bcf';
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

import { simpleItemCache } from './item-cache/simple';
import { challengeApiUrl } from './url';

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

export type EventTickMap = Record<number, Event[]>;
export type EventTypeMap = Record<string, Event[]>;
export type PlayerStateMap = Map<string, Nullable<PlayerState>[]>;
export type RoomNpcMap = Map<number, EnhancedRoomNpc>;

type EventState = {
  eventsByTick: EventTickMap;
  eventsByType: EventTypeMap;
  playerState: PlayerStateMap;
  npcState: RoomNpcMap;
  bcf: BlertChartFormat;
};

type Nullable<T> = T | null;

type Item = {
  id: number;
  name: string;
  quantity: number;
};

export type PlayerEquipment = Record<EquipmentSlot, Item | null>;

export type PlayerState = Omit<PlayerUpdateEvent, 'type' | 'stage' | 'cId'> & {
  attack?: Attack & { damage?: number };
  spell?: Spell;
  diedThisTick: boolean;
  isDead: boolean;
  equipment: PlayerEquipment;
  skills: Partial<Record<Skill, SkillLevel>>;
  customState: CustomPlayerState[];
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
  prayers: PrayerSet;
  id: number;
  label?: string;
};

type StageInfo = {
  ticks: number;
  npcs: RawRoomNpcMap;
};

function getStageInfo(
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

        const eventState = {
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
        };

        setEventState(eventState);
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
    ...eventState,
  };
}

function buildEventMaps(events: Event[]): [EventTickMap, EventTypeMap] {
  const byTick: EventTickMap = {};
  const byType: EventTypeMap = {};

  for (const event of events) {
    byTick[event.tick] ??= [];
    byTick[event.tick].push(event);

    byType[event.type] ??= [];
    byType[event.type].push(event);
  }

  return [byTick, byType];
}

function eventBelongsToPlayer(event: Event, playerName: string): boolean {
  return isPlayerEvent(event) && event.player.name === playerName;
}

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
  const playerState = new Map<string, Nullable<PlayerState>[]>();

  for (const partyMember of party) {
    const state = Array<Nullable<PlayerState>>(totalTicks).fill(null);

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
            const { type: _type, stage: _stage, ...rest } = event;

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
            const attack = event.attack;
            if (attack.weapon) {
              attack.weapon.name = simpleItemCache.getItemName(
                attack.weapon.id,
              );
            }
            playerStateThisTick = {
              ...playerStateThisTick!,
              attack,
            };
          } else if (event.type === EventType.PLAYER_SPELL) {
            playerStateThisTick = {
              ...playerStateThisTick!,
              spell: event.spell,
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
      if (previousItem?.id !== delta.getItemId()) {
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
        previousItem.quantity - delta.getQuantity() > 0
      ) {
        equipment[delta.getSlot()] = {
          ...previousItem,
          quantity: previousItem.quantity - delta.getQuantity(),
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
      stateByTick: Array<Nullable<NpcState>>(totalTicks).fill(null),
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
          id: eventsForThisNpc[0].npc.id,
          attack: null,
          position: {
            x: eventsForThisNpc[0].xCoord,
            y: eventsForThisNpc[0].yCoord,
          },
          hitpoints: SkillLevel.fromRaw(eventsForThisNpc[0].npc.hitpoints),
          prayers: PrayerSet.fromRaw(eventsForThisNpc[0].npc.prayers),
        };
        lastActiveTick = i;
      }

      const attackEvent = eventsForThisTick.find(
        (e) =>
          e.type === EventType.NPC_ATTACK && e.npc.roomId === Number(roomId),
      ) as NpcAttackEvent | undefined;
      if (attackEvent !== undefined) {
        if (npc.stateByTick[i] === null) {
          const hitpoints =
            lastActiveTick !== -1
              ? npc.stateByTick[lastActiveTick]!.hitpoints
              : new SkillLevel(0, 1);
          const prayers =
            lastActiveTick !== -1
              ? npc.stateByTick[lastActiveTick]!.prayers
              : PrayerSet.fromRaw(0);
          npc.stateByTick[i] = {
            id: attackEvent.npc.id,
            attack: null,
            position: {
              x: eventsForThisNpc[0].xCoord,
              y: eventsForThisNpc[0].yCoord,
            },
            hitpoints,
            prayers,
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
  state: Nullable<PlayerState>[],
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
      if (tickState.attack !== undefined) {
        tickState.attack.damage = dawn.damage;
      }
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
  } else if (npc.spawnNpcId === (NpcId.JAL_ZEK as number)) {
    for (let tick = 0; tick < npc.stateByTick.length; tick++) {
      const attack = npc.stateByTick[tick]?.attack;
      if (!attack) {
        continue;
      }
      if (attack.type === NpcAttack.INFERNO_MAGER_RESURRECT) {
        const target = (
          eventsByType[EventType.NPC_SPAWN] as NpcSpawnEvent[]
        )?.find((event) => {
          const npcSpawn = event.npc;
          return !Npc.isBloblet(npcSpawn.id) && event.tick === tick;
        });
        if (target) {
          attack.target = getNpcDefinition(target.npc.id)?.fullName ?? null;
        }
      }
    }
  }
}

type CustomEntitiesCallback = (tick: number) => AnyEntity[];
type ModifyEntityCallback = (tick: number, entity: AnyEntity) => AnyEntity;

type CustomEntitiesOptions = {
  customEntitiesForTick?: CustomEntitiesCallback;
  modifyEntity?: ModifyEntityCallback;
};

/**
 * Returns a map of tick to entities for a stage in a challenge.
 *
 * @param challenge Challenge to which the stage belongs.
 * @param playerState Player state for the stage.
 * @param npcState NPC state for the stage.
 * @param totalTicks Total number of ticks in the stage.
 * @param options Options to configure the entities.
 * @returns Map of tick to entities.
 */
export function useMapEntities(
  challenge: Challenge | null,
  playerState: PlayerStateMap,
  npcState: RoomNpcMap,
  totalTicks: number,
  options: CustomEntitiesOptions = {},
): { entitiesByTick: Map<number, AnyEntity[]>; preloads: string[] } {
  const { customEntitiesForTick = () => [], modifyEntity = (_, e) => e } =
    options;

  const [entitiesByTick, preloads] = useMemo(() => {
    const entities = new Map<number, AnyEntity[]>();
    const preloads = new Set<string>();

    if (challenge === null) {
      return [entities, []];
    }

    const partyOrb = challenge.party.reduce(
      (acc, p, i) => {
        acc[p.username] = i;
        return acc;
      },
      {} as Record<string, number>,
    );

    for (let tick = 0; tick < totalTicks; tick++) {
      const entitiesForTick: AnyEntity[] = [];

      for (const [playerName, state] of playerState) {
        const playerState = state?.at(tick);
        if (!playerState) {
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
          { x: playerState.xCoord, y: playerState.yCoord },
          playerName,
          orb,
          { current: playerState.skills[Skill.HITPOINTS], next: nextHitpoints },
          nextPosition,
        );

        entitiesForTick.push(modifyEntity(tick, playerEntity));
      }

      for (const [roomId, npc] of npcState) {
        const npcState = npc.stateByTick[tick];
        if (!npcState) {
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
          npcState.position,
          npcState.id,
          roomId,
          { current: npcState.hitpoints, next: nextHitpoints },
          npcState.prayers,
          nextPosition,
        );

        npcEntity = modifyEntity(tick, npcEntity) as NpcEntity;
        preloads.add(npcEntity.imageUrl);
        entitiesForTick.push(npcEntity);
      }

      entitiesForTick.push(...customEntitiesForTick(tick));

      entities.set(tick, entitiesForTick);
    }

    return [entities, Array.from(preloads)];
  }, [
    challenge,
    npcState,
    playerState,
    totalTicks,
    customEntitiesForTick,
    modifyEntity,
  ]);

  return { entitiesByTick, preloads };
}

/**
 * Options for converting to BCF format.
 */
export type ToBcfOptions = {
  /** Chart name. */
  name?: string;
  /** Chart description. */
  description?: string;
};

export function toBcfNormalizedPlayerName(name: string): string {
  return name.toLowerCase().replace(/ /g, '_');
}

export type NpcActorId = `npc-${number}`;

export function isNpcActorId(id: string): id is NpcActorId {
  return id.startsWith('npc-');
}

export function toNpcActorId(roomId: number): NpcActorId {
  return `npc-${roomId}`;
}

export function extractNpcRoomId(id: NpcActorId): number {
  return Number(id.substring(4));
}

/**
 * Converts player and NPC state maps to a BCF document.
 *
 * @param totalTicks Total number of ticks in the timeline.
 * @param eventsByTick Map of tick to events from `useStageEvents`.
 * @param playerState Player state map from `useStageEvents`.
 * @param npcState NPC state map from `useStageEvents`.
 * @param options Optional configuration.
 * @returns A BCF document.
 */
export function toBcf(
  challenge: Challenge,
  stage: Stage,
  totalTicks: number,
  eventsByTick: EventTickMap,
  eventsByType: EventTypeMap,
  playerState: PlayerStateMap,
  npcState: RoomNpcMap,
  options: ToBcfOptions = {},
): BlertChartFormat {
  const { name, description } = options;

  const npcActorIds = new Map<number, NpcActorId>();

  const actors: BCFActor[] = [];

  const encounterPhases = buildBcfEncounterPhases(
    challenge,
    stage,
    eventsByType,
  );

  for (const playerName of playerState.keys()) {
    actors.push({
      type: 'player',
      id: toBcfNormalizedPlayerName(playerName),
      name: playerName,
    });
  }

  for (const [roomId, npc] of npcState) {
    const actorId = toNpcActorId(roomId);
    npcActorIds.set(roomId, actorId);

    // The death tick reported by the server is the tick at which the NPC fully
    // despawns following its death animation. However, for the purpose of
    // displaying charts, what we really care about is when the NPC's HP hits 0,
    // as that's when it effectively dies.
    let deathTick = npc.deathTick;
    while (
      deathTick > npc.spawnTick + 1 &&
      npc.stateByTick[deathTick - 1]?.hitpoints.getCurrent() === 0
    ) {
      deathTick--;
    }

    const npcDef = getNpcDefinition(npc.spawnNpcId);
    actors.push({
      type: 'npc',
      id: actorId,
      name: npcDef?.shortName ?? `NPC ${npc.spawnNpcId}`,
      npcId: npc.spawnNpcId,
      spawnTick: npc.spawnTick,
      deathTick,
    });
  }

  const ticks: BCFTick[] = [];
  for (let tick = 0; tick < totalTicks; tick++) {
    const tickData = buildTick(
      tick,
      playerState,
      npcState,
      eventsByTick[tick] ?? [],
      npcActorIds,
    );
    if (tickData !== null) {
      ticks.push(tickData);
    }
  }

  const rowOrder = [
    ...Array.from(npcState.entries())
      .filter(([_, npc]) => npc.hasAttacks)
      .map(([roomId]) => toNpcActorId(roomId)),
    ...Array.from(playerState.keys()).map(toBcfNormalizedPlayerName),
  ];

  return {
    version: '1.0',
    name,
    description,
    config: { totalTicks, rowOrder, startTick: 1 },
    timeline: { actors, ticks, phases: encounterPhases },
  };
}

/**
 * Transforms a BCF document by applying a transform function to each action.
 *
 * @param bcf BCF document to transform.
 * @param transformAction Transform function applied to each action.
 * @returns Transformed BCF document.
 */
export function transformBcf(
  bcf: BlertChartFormat,
  transformAction: (action: BCFAction) => BCFAction | null,
): BlertChartFormat {
  return {
    ...bcf,
    timeline: {
      ...bcf.timeline,
      ticks: bcf.timeline.ticks.map((tick) => ({
        ...tick,
        cells: tick.cells.map((cell) => ({
          ...cell,
          actions: transformCellActions(cell.actions, transformAction),
        })),
      })),
    },
  };
}

function transformCellActions(
  actions: BCFAction[] | undefined,
  transformAction: (action: BCFAction) => BCFAction | null,
): BCFAction[] | undefined {
  if (actions === undefined) {
    return undefined;
  }

  const newActions: BCFAction[] = [];
  for (const action of actions) {
    const transformed = transformAction(action);
    if (transformed !== null) {
      newActions.push(transformed);
    }
  }
  return newActions.length > 0 ? newActions : undefined;
}

function buildBcfEncounterPhases(
  challenge: Challenge,
  stage: Stage,
  eventsByType: EventTypeMap,
): BCFPhase[] {
  const encounterPhases: BCFPhase[] = [];

  if (stage >= Stage.COLOSSEUM_WAVE_1 && stage <= Stage.COLOSSEUM_WAVE_11) {
    const reinforcementTick = eventsByType[EventType.NPC_SPAWN]?.find((e) => {
      const npcId = (e as NpcSpawnEvent).npc.id;
      return (
        e.tick > 1 && (Npc.isJaguarWarrior(npcId) || Npc.isMinotaur(npcId))
      );
    });
    if (reinforcementTick !== undefined) {
      encounterPhases.push({
        tick: reinforcementTick.tick,
        phaseType: 'COLOSSEUM_REINFORCEMENTS',
      });
    }
    return encounterPhases;
  }

  if (stage === Stage.INFERNO_WAVE_69) {
    eventsByType[EventType.NPC_SPAWN]?.forEach((evt) => {
      const npcId = (evt as NpcSpawnEvent).npc.id;
      switch (npcId) {
        case NpcId.JAL_ZEK_ZUK as number:
          encounterPhases.push({
            tick: evt.tick,
            phaseType: 'INFERNO_ZUK_SET',
          });
          break;
        case NpcId.JALTOK_JAD_ZUK as number:
          encounterPhases.push({
            tick: evt.tick,
            phaseType: 'INFERNO_ZUK_JAD',
          });
          break;
        case NpcId.JAL_MEJJAK as number:
          encounterPhases.push({
            tick: evt.tick,
            phaseType: 'INFERNO_ZUK_HEALERS',
          });
          break;
      }
    });

    return encounterPhases;
  }

  const addSplitPhase = (split: SplitType, name?: string) => {
    const splitTick = challenge.splits[split];
    if (splitTick !== undefined) {
      encounterPhases.push({
        tick: splitTick,
        phaseType: name ?? SplitType[split],
      });
    }
  };

  switch (stage) {
    case Stage.TOB_MAIDEN:
      addSplitPhase(SplitType.TOB_MAIDEN_70S);
      addSplitPhase(SplitType.TOB_MAIDEN_50S);
      addSplitPhase(SplitType.TOB_MAIDEN_30S);
      break;

    case Stage.TOB_NYLOCAS:
      eventsByType[EventType.TOB_NYLO_WAVE_SPAWN]?.forEach((event) => {
        const wave = (event as NyloWaveSpawnEvent).nyloWave.wave;
        encounterPhases.push({
          tick: event.tick,
          phaseType: `TOB_NYLO_WAVE_${wave}`,
        });
      });
      addSplitPhase(SplitType.TOB_NYLO_CLEANUP);
      addSplitPhase(SplitType.TOB_NYLO_BOSS_SPAWN);
      break;

    case Stage.TOB_SOTETSEG:
      addSplitPhase(SplitType.TOB_SOTETSEG_66, 'TOB_SOTETSEG_MAZE_1');
      addSplitPhase(SplitType.TOB_SOTETSEG_33, 'TOB_SOTETSEG_MAZE_2');
      break;
  }

  return encounterPhases;
}

function buildTick(
  tick: number,
  playerState: PlayerStateMap,
  npcState: RoomNpcMap,
  events: Event[],
  npcActorIds: Map<number, NpcActorId>,
): BCFTick | null {
  const cells: BCFCell[] = [];

  for (const [playerName, states] of playerState) {
    const state = states[tick];
    if (state === null) {
      continue;
    }

    const cell = buildPlayerCell(
      toBcfNormalizedPlayerName(playerName),
      state,
      npcActorIds,
    );
    if (cell !== null) {
      cells.push(cell);
    }
  }

  for (const [roomId, npc] of npcState) {
    const cell = buildNpcCell(npcActorIds.get(roomId)!, tick, npc, events);
    if (cell !== null) {
      cells.push(cell);
    }
  }

  if (cells.length > 0) {
    return { tick, cells };
  }

  return null;
}

function buildPlayerCell(
  actorId: string,
  state: PlayerState,
  npcActorIds: Map<number, string>,
): BCFCell | null {
  const actions: BCFAction[] = [];

  if (state.attack) {
    const attackType = PlayerAttack[state.attack.type] ?? 'UNKNOWN';
    const targetActorId =
      state.attack.target?.roomId !== undefined
        ? npcActorIds.get(state.attack.target.roomId)
        : undefined;

    actions.push({
      type: 'attack',
      attackType,
      weaponId: state.attack.weapon?.id,
      targetActorId,
      distanceToTarget: state.attack.distanceToTarget,
      damage: state.attack.damage,
    });
  }

  if (state.spell) {
    const spellType = PlayerSpell[state.spell.type] ?? 'UNKNOWN';
    let targetActorId: string | undefined;

    if (state.spell.target.type === SpellTarget.PLAYER) {
      targetActorId = toBcfNormalizedPlayerName(state.spell.target.player);
    } else if (state.spell.target.type === SpellTarget.NPC) {
      targetActorId = npcActorIds.get(state.spell.target.npc.roomId);
    }

    actions.push({
      type: 'spell',
      spellType,
      targetActorId,
    });
  }

  if (state.diedThisTick) {
    actions.push({ type: 'death' });
  }

  const cellState: BCFPlayerState = {};
  let hasState = false;

  if (state.isDead || state.diedThisTick) {
    cellState.isDead = true;
    hasState = true;
  }

  if (state.player.offCooldownTick <= state.tick) {
    cellState.offCooldown = true;
    hasState = true;
  }

  if (actions.length === 0 && !hasState) {
    return null;
  }

  return {
    actorId,
    actions: actions.length > 0 ? actions : undefined,
    state: hasState ? cellState : undefined,
  };
}

function buildNpcCell(
  actorId: string,
  tick: number,
  npc: EnhancedRoomNpc,
  events: Event[],
): BCFCell | null {
  const actions: BCFAction[] = [];

  const phaseEvent = getNpcPhaseAction(npc, tick, events);
  if (phaseEvent !== null) {
    actions.push(phaseEvent);
  }

  const state = npc.stateByTick[tick];
  if (state !== null) {
    if (state.attack) {
      const attackType = NpcAttack[state.attack.type] ?? 'UNKNOWN';
      let targetActorId =
        state.attack.target !== null
          ? toBcfNormalizedPlayerName(state.attack.target)
          : undefined;

      if (state.attack.type === NpcAttack.INFERNO_MAGER_RESURRECT) {
        const target = events.find(
          (event) =>
            event.type === EventType.NPC_SPAWN && !Npc.isBloblet(event.npc.id),
        );
        if (target !== undefined) {
          targetActorId = toNpcActorId((target as NpcSpawnEvent).npc.roomId);
        }
      }

      actions.push({
        type: 'npcAttack',
        attackType,
        targetActorId,
      });
    }
  }

  if (actions.length === 0) {
    return null;
  }
  return { actorId, actions: actions.length > 0 ? actions : undefined };
}

function getNpcPhaseAction(
  npc: EnhancedRoomNpc,
  tick: number,
  tickEvents: Event[],
): BCFNpcPhaseAction | null {
  const state = npc.stateByTick[tick];
  if (state === null) {
    return null;
  }

  if (Npc.isBloat(state.id)) {
    const downEvent = tickEvents.find(
      (e) => e.type === EventType.TOB_BLOAT_DOWN,
    );
    if (downEvent !== undefined) {
      return { type: 'npcPhase', phaseType: 'TOB_BLOAT_DOWN' };
    }
    const upEvent = tickEvents.find((e) => e.type === EventType.TOB_BLOAT_UP);
    if (upEvent !== undefined) {
      return { type: 'npcPhase', phaseType: 'TOB_BLOAT_UP' };
    }
  }

  // Create phase actions for Nylo bosses when their styles change.
  if (Npc.isNylocasPrinkipas(state.id) || Npc.isNylocasVasilias(state.id)) {
    const lastState = npc.stateByTick[tick - 1];
    if (lastState?.id !== state.id) {
      const phaseType = getNyloBossPhaseType(state.id);
      if (phaseType !== null) {
        return { type: 'npcPhase', phaseType };
      }
    }
  }

  if (Npc.isXarpus(state.id)) {
    const event = tickEvents.find((e) => e.type === EventType.TOB_XARPUS_PHASE);
    if (event !== undefined) {
      switch (event.xarpusPhase) {
        case XarpusPhase.P1:
          return { type: 'npcPhase', phaseType: 'TOB_XARPUS_P1' };
        case XarpusPhase.P2:
          return { type: 'npcPhase', phaseType: 'TOB_XARPUS_P2' };
        case XarpusPhase.P3:
          return { type: 'npcPhase', phaseType: 'TOB_XARPUS_P3' };
      }
    }
  }

  if (Npc.isVerzik(state.id)) {
    const phase = tickEvents.find((e) => e.type === EventType.TOB_VERZIK_PHASE);
    if (phase !== undefined) {
      switch (phase.verzikPhase) {
        case VerzikPhase.P1:
          return { type: 'npcPhase', phaseType: 'TOB_VERZIK_P1' };
        case VerzikPhase.P2:
          return { type: 'npcPhase', phaseType: 'TOB_VERZIK_P2' };
        case VerzikPhase.P3:
          return { type: 'npcPhase', phaseType: 'TOB_VERZIK_P3' };
      }
    }
  }

  return null;
}

function getNyloBossPhaseType(npcId: NpcId): string | null {
  switch (npcId) {
    case NpcId.NYLOCAS_PRINKIPAS_DROPPING:
    case NpcId.NYLOCAS_PRINKIPAS_MELEE:
    case NpcId.NYLOCAS_VASILIAS_DROPPING_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_DROPPING_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_DROPPING_HARD:
    case NpcId.NYLOCAS_VASILIAS_MELEE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_MELEE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_MELEE_HARD:
      return 'TOB_NYLO_BOSS_MELEE';

    case NpcId.NYLOCAS_PRINKIPAS_RANGE:
    case NpcId.NYLOCAS_VASILIAS_RANGE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_RANGE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_RANGE_HARD:
      return 'TOB_NYLO_BOSS_RANGED';

    case NpcId.NYLOCAS_PRINKIPAS_MAGE:
    case NpcId.NYLOCAS_VASILIAS_MAGE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_MAGE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_MAGE_HARD:
      return 'TOB_NYLO_BOSS_MAGE';
  }

  return null;
}
