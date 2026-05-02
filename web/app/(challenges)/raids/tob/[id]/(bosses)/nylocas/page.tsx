'use client';

import {
  EventType,
  NpcEvent,
  Npc,
  NyloWaveSpawnEvent,
  NpcId,
  Stage,
  SkillLevel,
  NyloWaveStallEvent,
  TobRaid,
  SplitType,
  RoomNpc,
  RoomNpcType,
  Nylo,
  NyloSpawn,
  NyloStyle,
  ChallengeMode,
  Coords,
} from '@blert/common';
import {
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useMemo,
  useState,
} from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Label,
} from 'recharts';

import { ActorContext } from '@/(challenges)/raids/tob/context';
import { TimelineColor, TimelineSplit } from '@/components/attack-timeline';
import Badge from '@/components/badge';
import BossFightOverview from '@/components/boss-fight-overview';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import BossPageParty from '@/components/boss-page-party';
import BossPageControls from '@/components/boss-page-controls';
import BossPageReplay from '@/components/boss-page-replay';
import Card from '@/components/card';
import HorizontalScrollable from '@/components/horizontal-scrollable';
import Loading from '@/components/loading';
import {
  AnyEntity,
  EntityType,
  MapDefinition,
  NpcEntity,
  osrsToThreePosition,
  Terrain,
} from '@/components/map-renderer';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import { useDisplay } from '@/display';
import {
  EnhancedNylo,
  EventTickMap,
  useMapEntities,
  usePreloads,
  usePlayingState,
  useStableEvents,
  useStageEvents,
} from '@/utils/boss-room-state';
import { inRect } from '@/utils/coords';
import { ticksToFormattedSeconds } from '@/utils/tick';

import NyloDimSettings, { DimThreshold } from './dim-settings';
import BarrierEntity from '../barrier';
import MissingStageData from '../missing-stage-data';

import bossStyles from '../style.module.scss';
import styles from './style.module.scss';

class NylocasTerrain implements Terrain {
  private static ROOM = { x: 3290, y: 4243, width: 12, height: 12 };

  private static PILLARS = [
    { x: 3290, y: 4243 },
    { x: 3300, y: 4243 },
    { x: 3290, y: 4253 },
    { x: 3300, y: 4253 },
  ].map((pillar) => ({ ...pillar, width: 2, height: 2 }));

  private static WEST_LANE = { x: 3280, y: 4248, width: 10, height: 2 };
  private static EAST_LANE = { x: 3302, y: 4248, width: 10, height: 2 };
  private static SOUTH_LANE = { x: 3295, y: 4233, width: 2, height: 10 };
  private static CORRIDOR = { x: 3294, y: 4256, width: 4, height: 28 };
  private static ENTRANCE = { x: 3295, y: 4255, width: 2, height: 1 };

  isPassable(coords: Coords): boolean {
    const inRoom = inRect(coords, NylocasTerrain.ROOM);
    if (inRoom) {
      return !NylocasTerrain.PILLARS.some((pillar) => inRect(coords, pillar));
    }

    return [
      NylocasTerrain.WEST_LANE,
      NylocasTerrain.EAST_LANE,
      NylocasTerrain.SOUTH_LANE,
      NylocasTerrain.CORRIDOR,
      NylocasTerrain.ENTRANCE,
    ].some((rect) => inRect(coords, rect));
  }
}

const NYLOCAS_MAP_DEFINITION: MapDefinition = {
  baseX: 3272,
  baseY: 4232,
  width: 48,
  height: 56,
  initialCameraPosition: { x: 3296, y: 4245 },
  faceSouth: true,
  terrain: new NylocasTerrain(),
};

const CAP_INCREASE_WAVE = 20;
const LAST_NYLO_WAVE = 31;

const GRAY_NYLO_COLOR = '#a9aaab';
const GREEN_NYLO_COLOR = '#408d43';
const BLUE_NYLO_COLOR = '#42c6d7';

/**
 * Returns the style-based color for a Nylocas NPC.
 *
 * @param npcId ID of the Nylo.
 * @param background If true, the color will be dimmed.
 * @returns Hex color code for the Nylo.
 */
function getNyloColor(npcId: NpcId, background?: boolean): string | undefined {
  let color = undefined;

  if (Npc.isNylocasIschyros(npcId)) {
    color = GRAY_NYLO_COLOR;
  } else if (Npc.isNylocasToxobolos(npcId)) {
    color = GREEN_NYLO_COLOR;
  } else if (Npc.isNylocasHagios(npcId)) {
    color = BLUE_NYLO_COLOR;
  } else {
    switch (npcId) {
      case NpcId.NYLOCAS_PRINKIPAS_DROPPING:
      case NpcId.NYLOCAS_PRINKIPAS_MELEE:
      case NpcId.NYLOCAS_VASILIAS_DROPPING_ENTRY:
      case NpcId.NYLOCAS_VASILIAS_DROPPING_REGULAR:
      case NpcId.NYLOCAS_VASILIAS_DROPPING_HARD:
      case NpcId.NYLOCAS_VASILIAS_MELEE_ENTRY:
      case NpcId.NYLOCAS_VASILIAS_MELEE_REGULAR:
      case NpcId.NYLOCAS_VASILIAS_MELEE_HARD:
        color = GRAY_NYLO_COLOR;
        break;

      case NpcId.NYLOCAS_PRINKIPAS_RANGE:
      case NpcId.NYLOCAS_VASILIAS_RANGE_ENTRY:
      case NpcId.NYLOCAS_VASILIAS_RANGE_REGULAR:
      case NpcId.NYLOCAS_VASILIAS_RANGE_HARD:
        color = GREEN_NYLO_COLOR;
        break;

      case NpcId.NYLOCAS_PRINKIPAS_MAGE:
      case NpcId.NYLOCAS_VASILIAS_MAGE_ENTRY:
      case NpcId.NYLOCAS_VASILIAS_MAGE_REGULAR:
      case NpcId.NYLOCAS_VASILIAS_MAGE_HARD:
        color = BLUE_NYLO_COLOR;
        break;
    }
  }

  if (color !== undefined && background) {
    // Apply an alpha value to the color to dim it.
    color = `${color}40`;
  }

  return color;
}

/**
 * Returns an array of timeline background color ranges for the ticks at which
 * a Nylo boss is alive.
 *
 * @param eventsByTick All room events, indexed by tick.
 * @param totalTicks Total number of ticks in the room.
 * @returns List of background colors to apply.
 */
function nyloBossBackgroundColors(
  eventsByTick: EventTickMap,
  totalTicks: number,
): TimelineColor[] {
  if (totalTicks === 0) {
    return [];
  }

  const colors: TimelineColor[] = [];

  let startTick: number | undefined = undefined;
  let bossId: NpcId | undefined = undefined;

  for (let tick = 0; tick <= totalTicks; tick++) {
    const bossEvent = eventsByTick[tick]?.find((evt) => {
      if (
        evt.type === EventType.NPC_SPAWN ||
        evt.type === EventType.NPC_UPDATE
      ) {
        return (
          Npc.isNylocasPrinkipas(evt.npc.id) ||
          Npc.isNylocasVasilias(evt.npc.id)
        );
      }
      return false;
    });

    const nyloBoss = (bossEvent as NpcEvent)?.npc;
    if (
      nyloBoss === undefined ||
      SkillLevel.fromRaw(nyloBoss.hitpoints).getCurrent() === 0
    ) {
      if (startTick !== undefined) {
        const backgroundColor = getNyloColor(bossId!, true);
        if (backgroundColor !== undefined) {
          colors.push({
            tick: startTick,
            length: tick - startTick,
            backgroundColor,
          });
        }
      }

      startTick = undefined;
      bossId = undefined;
      continue;
    }

    const nyloBossId = nyloBoss.id as NpcId;
    if (nyloBossId !== bossId) {
      if (startTick !== undefined) {
        const backgroundColor = getNyloColor(bossId!, true);
        if (backgroundColor !== undefined) {
          colors.push({
            tick: startTick,
            length: tick - startTick,
            backgroundColor,
          });
        }
      }

      startTick = tick;
      bossId = nyloBossId;
    }
  }

  return colors;
}

type Splits = { melee: number; ranged: number; mage: number };
type SplitCounts = {
  preCap: Splits;
  postCap: Splits;
};

function countSplits(npcs: Iterable<RoomNpc>): SplitCounts {
  const preCap = { melee: 0, ranged: 0, mage: 0 };
  const postCap = { melee: 0, ranged: 0, mage: 0 };

  for (const npc of npcs) {
    if (npc.type !== RoomNpcType.NYLO) {
      continue;
    }

    const nylo = npc as Nylo;
    if (nylo.nylo.spawnType === NyloSpawn.SPLIT) {
      const obj = nylo.nylo.wave < CAP_INCREASE_WAVE ? preCap : postCap;
      switch (nylo.nylo.style) {
        case NyloStyle.MAGE:
          obj.mage++;
          break;
        case NyloStyle.RANGE:
          obj.ranged++;
          break;
        case NyloStyle.MELEE:
          obj.melee++;
          break;
      }
    }
  }

  return { preCap, postCap };
}

type BossStyleChange = {
  tick: number;
  style: NyloStyle;
};

type BossRotation = {
  styleChanges: BossStyleChange[];
  counts: {
    mage: number;
    ranged: number;
    melee: number;
  };
};

/**
 * Determines the style of the Nylocas Vasilias based on its NPC ID.
 */
function nyloBossStyle(npcId: NpcId): NyloStyle {
  switch (npcId) {
    case NpcId.NYLOCAS_VASILIAS_MAGE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_MAGE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_MAGE_HARD:
      return NyloStyle.MAGE;

    case NpcId.NYLOCAS_VASILIAS_RANGE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_RANGE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_RANGE_HARD:
      return NyloStyle.RANGE;

    case NpcId.NYLOCAS_VASILIAS_MELEE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_MELEE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_MELEE_HARD:
      return NyloStyle.MELEE;
  }
  throw new Error(`Invalid Nylocas Vasilias ID: ${npcId}`);
}

const BARRIERS = [
  new BarrierEntity({ x: 3296, y: 4256 }, 2),
  new BarrierEntity({ x: 3302, y: 4249 }, 2, Math.PI / 2),
  new BarrierEntity({ x: 3296, y: 4243 }, 2, Math.PI),
  new BarrierEntity({ x: 3290, y: 4249 }, 2, (3 * Math.PI) / 2),
];

function getBarrierEntities(_tick: number): BarrierEntity[] {
  return [...BARRIERS];
}

export default function NylocasPage() {
  const display = useDisplay();
  const [dimThresholds, setDimThresholds] = useState<DimThreshold[]>([]);
  const [showLabels, setShowLabels] = useState(true);

  const compact = display.isCompact();

  const mapDefinition = useMemo(() => {
    const initialZoom = compact ? 13 : 26;
    return {
      ...NYLOCAS_MAP_DEFINITION,
      initialZoom,
    };
  }, [compact]);

  const {
    challenge,
    totalTicks,
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    bcf,
    loading,
    isLive,
    isStreaming,
  } = useStageEvents<TobRaid>(Stage.TOB_NYLOCAS);

  const {
    currentTick,
    setTick,
    playing,
    setPlaying,
    advanceTick,
    following,
    jumpToLive,
  } = usePlayingState(totalTicks, isStreaming);

  const { selectedActor, setSelectedActor } = useContext(ActorContext);

  const waveSpawnEvents = useStableEvents<NyloWaveSpawnEvent>(
    eventsByType,
    EventType.TOB_NYLO_WAVE_SPAWN,
  );
  const waveStallEvents = useStableEvents<NyloWaveStallEvent>(
    eventsByType,
    EventType.TOB_NYLO_WAVE_STALL,
  );
  const bossUpdateEvents = useStableEvents<NpcEvent>(
    eventsByType,
    EventType.NPC_UPDATE,
    (evt) => Npc.isNylocasVasilias(evt.npc.id),
  );

  const backgroundColors = useMemo(
    () => nyloBossBackgroundColors(eventsByTick, totalTicks),
    [eventsByTick, totalTicks],
  );

  const splits = useMemo(() => {
    if (challenge === null || waveSpawnEvents.length === 0) {
      return [];
    }
    const splits: TimelineSplit[] = waveSpawnEvents.map((evt) => {
      const wave = evt.nyloWave.wave;
      const importantWaves: Record<number, string> = {
        [CAP_INCREASE_WAVE]: 'Cap',
        [LAST_NYLO_WAVE]: 'Waves',
      };

      return {
        tick: evt.tick,
        splitName: importantWaves[wave] ?? wave.toString(),
        unimportant: importantWaves[wave] === undefined,
      };
    });

    if (challenge.splits[SplitType.TOB_NYLO_CLEANUP]) {
      splits.push({
        tick: challenge.splits[SplitType.TOB_NYLO_CLEANUP],
        splitName: 'Cleanup',
      });
    }
    if (challenge.splits[SplitType.TOB_NYLO_BOSS_SPAWN]) {
      splits.push({
        tick: challenge.splits[SplitType.TOB_NYLO_BOSS_SPAWN],
        splitName: 'Boss',
      });
    }
    return splits;
  }, [waveSpawnEvents, challenge]);

  const nyloNpcs = challenge?.tobRooms.nylocas?.npcs;
  const nyloSplits = useMemo(
    () => countSplits(nyloNpcs ? Object.values(nyloNpcs) : npcState.values()),
    [nyloNpcs, npcState],
  );

  const bossRotation = useMemo((): BossRotation => {
    const styleChanges: BossStyleChange[] = [];
    const counts = {
      mage: 0,
      ranged: 0,
      melee: 0,
    };

    if (bossUpdateEvents.length === 0) {
      return { styleChanges, counts };
    }

    let prevStyle: NyloStyle | null = null;

    bossUpdateEvents.forEach((evt) => {
      const style = nyloBossStyle(evt.npc.id as NpcId);

      if (style !== prevStyle) {
        styleChanges.push({
          tick: evt.tick,
          style,
        });

        switch (style) {
          case NyloStyle.MAGE:
            counts.mage += 1;
            break;
          case NyloStyle.RANGE:
            counts.ranged += 1;
            break;
          case NyloStyle.MELEE:
            counts.melee += 1;
            break;
        }

        prevStyle = style;
      }
    });

    return { styleChanges, counts };
  }, [bossUpdateEvents]);

  const nylosAliveByTick = useMemo(() => {
    const endTick = challenge?.splits[SplitType.TOB_NYLO_CLEANUP] ?? totalTicks;
    const nylosAlive = [];

    for (let tick = 0; tick <= endTick; tick++) {
      const nylos = eventsByTick[tick]?.reduce((acc, evt) => {
        if (
          evt.type !== EventType.NPC_SPAWN &&
          evt.type !== EventType.NPC_UPDATE
        ) {
          return acc;
        }
        const npc = (evt as NpcEvent).npc;
        if (Npc.isNylocas(npc.id)) {
          return acc + 1;
        }
        return acc;
      }, 0);
      nylosAlive.push({ tick, nylosAlive: nylos });
    }
    return nylosAlive;
  }, [eventsByTick, challenge, totalTicks]);

  const deferredNylosAlive = useDeferredValue(nylosAliveByTick);
  const deferredSpawns = useDeferredValue(waveSpawnEvents);
  const deferredStalls = useDeferredValue(waveStallEvents);

  const dimStartByRoomId = useMemo(() => {
    if (waveSpawnEvents.length === 0 || dimThresholds.length === 0) {
      return new Map<number, number>();
    }

    const waveTick = new Map<number, number>();
    for (const evt of waveSpawnEvents) {
      waveTick.set(evt.nyloWave.wave, evt.tick);
    }

    const starts = new Map<number, number>();

    for (const th of dimThresholds) {
      const spawnTick = waveTick.get(th.wave);
      if (spawnTick == null) {
        continue;
      }
      const dimTick = spawnTick + th.offset;

      for (const [roomId, npc] of npcState) {
        const npcId = npc.spawnNpcId as NpcId;
        const isBoss =
          Npc.isNylocasPrinkipas(npcId) ||
          Npc.isNylocasVasilias(npcId) ||
          Npc.isNylocasVasiliasDropping(npcId) ||
          npcId === NpcId.NYLOCAS_PRINKIPAS_DROPPING;
        if (isBoss) {
          continue;
        }

        if (npc.stateByTick[dimTick]) {
          const prev = starts.get(roomId);
          if (prev == null || dimTick < prev) {
            starts.set(roomId, dimTick);
          }
        }
      }
    }

    return starts;
  }, [dimThresholds, waveSpawnEvents, npcState]);

  const modifyNpcs = useCallback(
    (tick: number, entity: AnyEntity) => {
      if (entity.type !== EntityType.NPC) {
        return entity;
      }

      const npcEntity = entity as NpcEntity;
      const npc = npcState.get(npcEntity.roomId);
      if (npc === undefined) {
        return entity;
      }

      const spawnNpcId = npc.spawnNpcId as NpcId;

      // Check that the NPC:
      // 1. Spawned as a dropping boss (no late spectator join / lost ticks)
      // 2. Is on its spawn tick
      // If so, visually drop it down to the ground.
      const isDroppingBoss =
        Npc.isNylocasVasiliasDropping(spawnNpcId) ||
        spawnNpcId === NpcId.NYLOCAS_PRINKIPAS_DROPPING;

      if (isDroppingBoss && tick === npc.spawnTick) {
        const sizeOffset = (npcEntity.size - 1) / 2;
        const adjustedPosition = {
          x: npcEntity.position.x + sizeOffset,
          y: npcEntity.position.y + sizeOffset,
        };
        const finalHeight = npcEntity.size / 2 - 0.2;

        npcEntity.options.customInterpolation = {
          from: osrsToThreePosition(adjustedPosition, 10),
          to: osrsToThreePosition(adjustedPosition, finalHeight),
          ease: (t) => t * t,
        };
      }

      const isBoss =
        Npc.isNylocasPrinkipas(spawnNpcId) ||
        Npc.isNylocasVasilias(spawnNpcId) ||
        isDroppingBoss;

      if (!isBoss) {
        npcEntity.dimmed =
          (dimStartByRoomId.get(npcEntity.roomId) ?? Infinity) <= tick;

        if (showLabels && npc.type === RoomNpcType.NYLO) {
          const nylo = npc as EnhancedNylo;
          npcEntity.label = `W${nylo.nylo.wave}`;
        }
      }

      return entity;
    },
    [npcState, dimStartByRoomId, showLabels],
  );

  const getEntities = useMapEntities(
    challenge,
    playerState,
    npcState,
    totalTicks,
    { customEntitiesForTick: getBarrierEntities, modifyEntity: modifyNpcs },
  );
  const preloads = usePreloads(npcState, isLive);

  if (loading || challenge === null) {
    return <Loading />;
  }

  const nyloData = challenge.tobRooms.nylocas;
  if (!isLive && nyloData === null) {
    return <MissingStageData stage={Stage.TOB_NYLOCAS} />;
  }

  const playerTickState = challenge.party.reduce(
    (acc, { username }) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  const stalls = waveStallEvents.map((e) => e.nyloWave);

  const sections = [];

  if (
    challenge.splits[SplitType.TOB_NYLO_CAP] ||
    challenge.splits[SplitType.TOB_NYLO_WAVES] ||
    challenge.splits[SplitType.TOB_NYLO_CLEANUP] ||
    challenge.splits[SplitType.TOB_NYLO_BOSS_SPAWN]
  ) {
    sections.push({
      title: 'Room Times',
      content: (
        <div className={styles.splits}>
          {challenge.splits[SplitType.TOB_NYLO_CAP] && (
            <Badge
              iconClass="fa-solid fa-hourglass"
              label="Cap"
              value={ticksToFormattedSeconds(
                challenge.splits[SplitType.TOB_NYLO_CAP],
              )}
            />
          )}
          {challenge.splits[SplitType.TOB_NYLO_WAVES] && (
            <Badge
              iconClass="fa-solid fa-hourglass"
              label="Last wave"
              value={ticksToFormattedSeconds(
                challenge.splits[SplitType.TOB_NYLO_WAVES],
              )}
            />
          )}
          {challenge.splits[SplitType.TOB_NYLO_CLEANUP] && (
            <Badge
              iconClass="fa-solid fa-hourglass"
              label="Cleanup"
              value={ticksToFormattedSeconds(
                challenge.splits[SplitType.TOB_NYLO_CLEANUP],
              )}
            />
          )}
          {challenge.splits[SplitType.TOB_NYLO_BOSS_SPAWN] && (
            <Badge
              iconClass="fa-solid fa-hourglass"
              label="Boss"
              value={ticksToFormattedSeconds(
                challenge.splits[SplitType.TOB_NYLO_BOSS_SPAWN],
              )}
            />
          )}
        </div>
      ),
    });
  }

  sections.push({
    title: 'Nylo Splits',
    content: (
      <div className={styles.splitCounts}>
        <div className={styles.splitCountGroup}>
          <span className={styles.heading}>Pre-cap</span>
          <span
            className={styles.splitCount}
            style={{ color: BLUE_NYLO_COLOR }}
          >
            {nyloSplits.preCap.mage}
          </span>
          <span
            className={styles.splitCount}
            style={{ color: GREEN_NYLO_COLOR }}
          >
            {nyloSplits.preCap.ranged}
          </span>
          <span
            className={styles.splitCount}
            style={{ color: GRAY_NYLO_COLOR }}
          >
            {nyloSplits.preCap.melee}
          </span>
        </div>
        <div className={styles.splitCountGroup}>
          <span className={styles.heading}>Post-cap</span>
          <span
            className={styles.splitCount}
            style={{ color: BLUE_NYLO_COLOR }}
          >
            {nyloSplits.postCap.mage}
          </span>
          <span
            className={styles.splitCount}
            style={{ color: GREEN_NYLO_COLOR }}
          >
            {nyloSplits.postCap.ranged}
          </span>
          <span
            className={styles.splitCount}
            style={{ color: GRAY_NYLO_COLOR }}
          >
            {nyloSplits.postCap.melee}
          </span>
        </div>
        <div className={styles.splitCountGroup}>
          <span className={styles.heading}>Total</span>
          <span
            className={styles.splitCount}
            style={{ color: BLUE_NYLO_COLOR }}
          >
            {nyloSplits.preCap.mage + nyloSplits.postCap.mage}
          </span>
          <span
            className={styles.splitCount}
            style={{ color: GREEN_NYLO_COLOR }}
          >
            {nyloSplits.preCap.ranged + nyloSplits.postCap.ranged}
          </span>
          <span
            className={styles.splitCount}
            style={{ color: GRAY_NYLO_COLOR }}
          >
            {nyloSplits.preCap.melee + nyloSplits.postCap.melee}
          </span>
        </div>
      </div>
    ),
  });

  if (challenge.splits[SplitType.TOB_NYLO_BOSS_SPAWN]) {
    sections.push({
      title: 'Boss Rotation',
      content: (
        <div className={styles.bossRotationContainer}>
          <div className={styles.bossRotationBar}>
            {bossRotation.styleChanges.length > 0 ? (
              bossRotation.styleChanges.map((change, index) => {
                const style = change.style;
                let color = GRAY_NYLO_COLOR;
                let styleName = 'Melee';

                if (style === NyloStyle.MAGE) {
                  color = BLUE_NYLO_COLOR;
                  styleName = 'Mage';
                } else if (style === NyloStyle.RANGE) {
                  color = GREEN_NYLO_COLOR;
                  styleName = 'Ranged';
                }

                return (
                  <button
                    key={index}
                    className={styles.bossRotationSegment}
                    style={{ backgroundColor: color }}
                    data-tooltip-id={GLOBAL_TOOLTIP_ID}
                    data-tooltip-content={`${styleName} (Tick ${change.tick})`}
                    onClick={() => {
                      setTick(change.tick);
                    }}
                  />
                );
              })
            ) : (
              <div className={styles.bossRotationEmpty}>
                No style changes detected
              </div>
            )}
          </div>
          <div className={styles.bossRotationCounts}>
            <div
              className={styles.bossRotationCount}
              style={{ color: GRAY_NYLO_COLOR }}
            >
              <span className={styles.count}>
                {challenge.tobStats.nylocasBossMelee ||
                  bossRotation.counts.melee}
              </span>
              <span className={styles.label}>Melee</span>
            </div>
            <div
              className={styles.bossRotationCount}
              style={{ color: GREEN_NYLO_COLOR }}
            >
              <span className={styles.count}>
                {challenge.tobStats.nylocasBossRanged ||
                  bossRotation.counts.ranged}
              </span>
              <span className={styles.label}>Ranged</span>
            </div>
            <div
              className={styles.bossRotationCount}
              style={{ color: BLUE_NYLO_COLOR }}
            >
              <span className={styles.count}>
                {challenge.tobStats.nylocasBossMage || bossRotation.counts.mage}
              </span>
              <span className={styles.label}>Mage</span>
            </div>
          </div>
        </div>
      ),
    });
  }

  if (stalls.length > 0) {
    sections.push({
      title: `Stalled Waves (${stalls.length})`,
      span: display.isCompact() ? 1 : 3,
      content: (
        <HorizontalScrollable className={styles.stalls}>
          {stalls.map((stall, i) => {
            return (
              <div key={i} className={styles.stall}>
                <span className={styles.wave}>{stall.wave}</span>
                <span className={styles.nylos}>
                  {stall.nylosAlive}/{stall.roomCap}
                </span>
              </div>
            );
          })}
        </HorizontalScrollable>
      ),
    });
  }

  return (
    <>
      <div className={bossStyles.overview}>
        <BossFightOverview
          name="The Nylocas"
          image="/nyloking.webp"
          time={totalTicks}
          sections={sections}
        />
      </div>

      <div className={bossStyles.timeline}>
        <BossPageAttackTimeline
          currentTick={currentTick}
          playing={playing}
          playerState={playerState}
          timelineTicks={totalTicks}
          updateTickOnPage={setTick}
          splits={splits}
          backgroundColors={backgroundColors}
          bcf={bcf}
          npcs={npcState}
          smallLegend={display.isCompact()}
          liveFollowing={following}
        />
      </div>

      <div className={bossStyles.replayAndParty}>
        <BossPageReplay
          entities={getEntities(currentTick)}
          preloads={preloads}
          mapDef={mapDefinition}
          playing={playing}
          width={display.isCompact() ? 374 : 850}
          height={display.isCompact() ? 275 : 625}
          currentTick={currentTick}
          advanceTick={advanceTick}
          customControls={
            <NyloDimSettings
              scale={challenge.party.length}
              disabled={playing}
              onDimThresholdsChange={setDimThresholds}
              onShowLabelsChange={setShowLabels}
            />
          }
        />
        <BossPageParty
          playerTickState={playerTickState}
          selectedActor={selectedActor}
          setSelectedActor={setSelectedActor}
        />
      </div>

      <div className={bossStyles.charts}>
        <NyloWaveChart
          challenge={challenge}
          nylosAliveByTick={deferredNylosAlive}
          spawns={deferredSpawns}
          stalls={deferredStalls}
          animate={!isLive}
          width={display.isFull() ? '100%' : 1350}
        />
      </div>

      <BossPageControls
        currentlyPlaying={playing}
        totalTicks={totalTicks}
        currentTick={currentTick}
        updateTick={setTick}
        updatePlayingState={setPlaying}
        splits={splits}
        following={following}
        onJumpToLive={isStreaming ? jumpToLive : undefined}
      />
    </>
  );
}

const NYLO_CHART_MARGIN = { left: -10, bottom: 20 };
const NYLO_AXIS_LINE = { stroke: 'var(--blert-surface-light)' };
const NYLO_TOOLTIP_STYLE = {
  backgroundColor: 'var(--blert-surface-dark)',
  border: '1px solid var(--blert-surface-light)',
  borderRadius: '8px',
  color: 'var(--blert-font-color-primary)',
  padding: '8px',
};
const NYLO_TOOLTIP_CURSOR = {
  stroke: 'var(--blert-divider-color)',
  strokeWidth: 1,
};

function formatNylosAlive(value: number) {
  return [value, 'Nylos Alive'];
}

const NyloWaveChart = memo(function NyloWaveChart({
  challenge,
  nylosAliveByTick,
  spawns,
  stalls,
  width,
  animate = true,
}: {
  challenge: TobRaid;
  nylosAliveByTick: { tick: number; nylosAlive: number }[];
  spawns: NyloWaveSpawnEvent[];
  stalls: NyloWaveStallEvent[];
  width: number | string;
  animate?: boolean;
}) {
  const startingRoomCap = challenge.mode === ChallengeMode.TOB_HARD ? 15 : 12;

  return (
    <Card
      className={bossStyles.chart}
      header={{ title: 'Nylos Alive By Tick' }}
    >
      <HorizontalScrollable className={bossStyles.scrollable}>
        <ResponsiveContainer width={width} height="100%">
          <AreaChart data={nylosAliveByTick} margin={NYLO_CHART_MARGIN}>
            <defs>
              <linearGradient
                id="backgroundGradient"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor="var(--blert-purple)"
                  stopOpacity={0.3}
                />
                <stop
                  offset="100%"
                  stopColor="var(--blert-purple)"
                  stopOpacity={0.05}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--blert-surface-light)"
              opacity={0.9}
            />
            <XAxis
              dataKey="tick"
              stroke="var(--blert-font-color-secondary)"
              tickLine={false}
              axisLine={NYLO_AXIS_LINE}
              hide
            />
            <YAxis
              stroke="var(--blert-font-color-secondary)"
              tickLine={false}
              axisLine={NYLO_AXIS_LINE}
              tickCount={8}
            />
            <Area
              type="monotone"
              dataKey="nylosAlive"
              stroke="rgba(var(--blert-purple-base), 0.7)"
              strokeWidth={2}
              fill="url(#backgroundGradient)"
              isAnimationActive={animate}
            />
            <Tooltip
              contentStyle={NYLO_TOOLTIP_STYLE}
              formatter={formatNylosAlive}
              labelFormatter={(tick: number) => {
                if (spawns.length === 0) {
                  return `Tick: ${tick} (No wave)`;
                }

                let waveSpawn;
                for (let i = 1; i < spawns.length; i++) {
                  if (tick < spawns[i].tick) {
                    waveSpawn = spawns[i - 1];
                    break;
                  }
                }
                waveSpawn ??= spawns[spawns.length - 1];

                return `Tick: ${tick} (Wave ${waveSpawn.nyloWave.wave})`;
              }}
              cursor={NYLO_TOOLTIP_CURSOR}
            />
            <ReferenceLine
              stroke="rgba(var(--blert-red-base), 0.7)"
              strokeWidth={2}
              strokeDasharray="2 2"
              segment={[
                { x: 0, y: startingRoomCap },
                {
                  x: challenge.splits[SplitType.TOB_NYLO_CAP],
                  y: startingRoomCap,
                },
              ]}
            >
              <Label
                position="top"
                stroke="rgba(var(--blert-font-color-primary-base), 0.7)"
                style={{ fontWeight: 200 }}
              >
                Room cap
              </Label>
            </ReferenceLine>
            <ReferenceLine
              stroke="rgba(var(--blert-red-base), 0.7)"
              strokeWidth={2}
              strokeDasharray="2 2"
              segment={[
                { x: challenge.splits[SplitType.TOB_NYLO_CAP], y: 24 },
                { x: challenge.splits[SplitType.TOB_NYLO_CLEANUP], y: 24 },
              ]}
            >
              <Label
                position="top"
                stroke="rgba(var(--blert-font-color-primary-base), 0.7)"
                style={{ fontWeight: 200 }}
              >
                Room cap
              </Label>
            </ReferenceLine>
            {spawns.map((evt) => {
              return (
                <ReferenceLine
                  key={evt.tick}
                  x={evt.tick}
                  stroke={
                    evt.nyloWave.wave === CAP_INCREASE_WAVE
                      ? 'rgba(var(--blert-font-color-primary-base), 0.75)'
                      : 'rgba(var(--blert-font-color-primary-base), 0.15)'
                  }
                  strokeWidth={1}
                >
                  <Label
                    stroke={
                      evt.nyloWave.wave === CAP_INCREASE_WAVE
                        ? 'rgba(var(--blert-font-color-primary-base), 0.8)'
                        : 'var(--blert-font-color-secondary)'
                    }
                    position="bottom"
                    style={{ fontSize: 13, fontWeight: 100 }}
                  >
                    {evt.nyloWave.wave}
                  </Label>
                </ReferenceLine>
              );
            })}
            {stalls.map((evt) => {
              return (
                <ReferenceLine
                  key={evt.tick}
                  x={evt.tick}
                  stroke="rgba(var(--blert-font-color-primary-base), 0.5)"
                  strokeWidth={2}
                  strokeDasharray="3 3"
                >
                  <Label
                    stroke="rgba(var(--blert-red-base), 0.7)"
                    position="bottom"
                    style={{ fontSize: 13, fontWeight: 100 }}
                  >
                    {evt.nyloWave.wave}
                  </Label>
                </ReferenceLine>
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      </HorizontalScrollable>
    </Card>
  );
});
