'use client';

import {
  ChallengeStatus,
  EventType,
  PlayerUpdateEvent,
  NpcEvent,
  Npc,
  NyloWaveSpawnEvent,
  NpcId,
  Stage,
  SkillLevel,
  NyloWaveStallEvent,
  TobRaid,
  SplitType,
  RoomNpcType,
  Nylo,
  NyloSpawn,
  NyloStyle,
  RoomNpcMap,
  ChallengeMode,
} from '@blert/common';
import { useContext, useMemo } from 'react';
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

import { TimelineColor, TimelineSplit } from '@/components/attack-timeline';
import Badge from '@/components/badge';
import BossFightOverview from '@/components/boss-fight-overview';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import BossPageParty from '@/components/boss-page-party';
import BossPageControls from '@/components/boss-page-controls';
import BossPageReplay from '@/components/boss-page-replay';
import {
  EventTickMap,
  useLegacyTickTimeout,
  usePlayingState,
  useStageEvents,
} from '@/utils/boss-room-state';
import Card from '@/components/card';
import HorizontalScrollable from '@/components/horizontal-scrollable';
import Loading from '@/components/loading';
import {
  Entity,
  NpcEntity,
  PlayerEntity,
  OverlayEntity,
} from '@/components/map';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import { DisplayContext } from '@/display';
import { ActorContext } from '@/(challenges)/raids/tob/context';
import { ticksToFormattedSeconds } from '@/utils/tick';

import nyloBaseTiles from './nylo-tiles.json';
import bossStyles from '../style.module.scss';
import styles from './style.module.scss';

const NYLOCAS_MAP_DEFINITION = {
  baseX: 3279,
  baseY: 4232,
  width: 34,
  height: 25,
  faceSouth: true,
  baseTiles: nyloBaseTiles,
};

const LAST_NYLO_WAVE = 31;

const GRAY_NYLO_COLOR = '#a9aaab';
const GREEN_NYLO_COLOR = '#408d43';
const BLUE_NYLO_COLOR = '#42c6d7';

const NORTH_BARRIER = new OverlayEntity(
  3299,
  4255,
  'barrier',
  (
    <div className={styles.barrierNorth}>
      <div className={styles.entrance}></div>
    </div>
  ),
  /*interactable=*/ false,
);

const WEST_BARRIER = new OverlayEntity(
  3289,
  4245,
  'barrier',
  (
    <div className={styles.barrierWest}>
      <div className={styles.entrance}></div>
    </div>
  ),
  /*interactable=*/ false,
);

const SOUTH_BARRIER = new OverlayEntity(
  3299,
  4242,
  'barrier',
  (
    <div className={styles.barrierSouth}>
      <div className={styles.entrance}></div>
    </div>
  ),
  /*interactable=*/ false,
);

const EAST_BARRIER = new OverlayEntity(
  3302,
  4245,
  'barrier',
  (
    <div className={styles.barrierEast}>
      <div className={styles.entrance}></div>
    </div>
  ),
  /*interactable=*/ false,
);

/**
 * Returns the style-based color for a Nylocas NPC.
 *
 * @param npcId ID of the Nylo.
 * @param background If true, the color will be dimmed.
 * @returns Hex color code for the Nylo.
 */
function getNyloColor(npcId: number, background?: boolean): string | undefined {
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

  let colors: TimelineColor[] = [];

  let startTick: number | undefined = undefined;
  let bossId: number | undefined = undefined;

  for (let tick = 0; tick <= totalTicks; tick++) {
    const bossEvent = eventsByTick[tick]?.find((evt) => {
      if (
        evt.type === EventType.NPC_SPAWN ||
        evt.type === EventType.NPC_UPDATE
      ) {
        const e = evt as NpcEvent;
        return (
          Npc.isNylocasPrinkipas(e.npc.id) || Npc.isNylocasVasilias(e.npc.id)
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
            length: tick - startTick + 1,
            backgroundColor,
          });
        }
      }

      startTick = undefined;
      bossId = undefined;
      continue;
    }

    if (nyloBoss.id !== bossId) {
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
      bossId = nyloBoss.id;
    }
  }

  return colors;
}

type Splits = { melee: number; ranged: number; mage: number };
type SplitCounts = {
  preCap: Splits;
  postCap: Splits;
};

function countSplits(npcs: RoomNpcMap): SplitCounts {
  const preCap = { melee: 0, ranged: 0, mage: 0 };
  const postCap = { melee: 0, ranged: 0, mage: 0 };

  Object.values(npcs).forEach((npc) => {
    if (npc.type !== RoomNpcType.NYLO) {
      return;
    }

    const nylo = npc as Nylo;
    if (nylo.nylo.spawnType === NyloSpawn.SPLIT) {
      const obj = nylo.nylo.wave < 20 ? preCap : postCap;
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
  });

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
function nyloBossStyle(npcId: number): NyloStyle {
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

export default function NylocasPage() {
  const display = useContext(DisplayContext);

  const {
    challenge: raidData,
    totalTicks,
    events,
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    loading,
  } = useStageEvents<TobRaid>(Stage.TOB_NYLOCAS);

  const { currentTick, setTick, playing, setPlaying, advanceTick } =
    usePlayingState(totalTicks);
  const { updateTickOnPage } = useLegacyTickTimeout(
    true,
    playing,
    currentTick,
    setTick,
  );

  const { selectedPlayer, setSelectedPlayer } = useContext(ActorContext);

  const backgroundColors = useMemo(
    () => nyloBossBackgroundColors(eventsByTick, totalTicks),
    [eventsByTick, totalTicks],
  );

  const splits = useMemo(() => {
    if (raidData === null || events.length === 0) {
      return [];
    }
    let splits: TimelineSplit[] =
      eventsByType[EventType.TOB_NYLO_WAVE_SPAWN]?.map((evt) => {
        const wave = (evt as NyloWaveSpawnEvent).nyloWave.wave;
        const importantWaves: { [wave: number]: string } = {
          20: 'Cap',
          31: 'Waves',
        };

        return {
          tick: evt.tick,
          splitName: importantWaves[wave] ?? wave.toString(),
          unimportant: importantWaves[wave] === undefined,
        };
      }) ?? [];

    if (raidData.splits[SplitType.TOB_NYLO_CLEANUP]) {
      splits.push({
        tick: raidData.splits[SplitType.TOB_NYLO_CLEANUP],
        splitName: 'Cleanup',
      });
    }
    if (raidData.splits[SplitType.TOB_NYLO_BOSS_SPAWN]) {
      splits.push({
        tick: raidData.splits[SplitType.TOB_NYLO_BOSS_SPAWN],
        splitName: 'Boss',
      });
    }
    return splits;
  }, [events, eventsByType, raidData]);

  const nyloSplits = useMemo(
    () => countSplits(raidData?.tobRooms.nylocas?.npcs ?? {}),
    [raidData],
  );

  const bossRotation = useMemo((): BossRotation => {
    if (!eventsByType) {
      return { styleChanges: [], counts: { mage: 0, ranged: 0, melee: 0 } };
    }

    const styleChanges: BossStyleChange[] = [];
    const counts = {
      mage: 0,
      ranged: 0,
      melee: 0,
    };

    const bossUpdateEvents = (
      (eventsByType[EventType.NPC_UPDATE] as NpcEvent[]) ?? []
    ).filter((evt) => Npc.isNylocasVasilias((evt as NpcEvent).npc.id));

    if (bossUpdateEvents.length === 0) {
      return { styleChanges, counts };
    }

    let prevStyle: NyloStyle | null = null;

    bossUpdateEvents.forEach((evt) => {
      const style = nyloBossStyle(evt.npc.id);

      if (style !== prevStyle) {
        styleChanges.push({
          tick: evt.tick,
          style,
        });

        if (prevStyle !== null) {
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
        }

        prevStyle = style;
      }
    });

    return { styleChanges, counts };
  }, [eventsByType]);

  const nylosAliveByTick = useMemo(() => {
    const endTick = raidData?.splits[SplitType.TOB_NYLO_CLEANUP] ?? totalTicks;
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
  }, [eventsByTick, raidData, totalTicks]);

  if (loading || raidData === null) {
    return <Loading />;
  }

  const nyloData = raidData.tobRooms.nylocas;
  if (raidData.status !== ChallengeStatus.IN_PROGRESS && nyloData === null) {
    return <>No Nylocas data for this raid</>;
  }

  const eventsForCurrentTick = eventsByTick[currentTick] ?? [];

  const entities: Entity[] = [
    NORTH_BARRIER,
    WEST_BARRIER,
    SOUTH_BARRIER,
    EAST_BARRIER,
  ];
  const players: PlayerEntity[] = [];

  let nylosAlive = 0;

  for (const evt of eventsForCurrentTick) {
    switch (evt.type) {
      case EventType.PLAYER_UPDATE: {
        const e = evt as PlayerUpdateEvent;
        const hitpoints = e.player.hitpoints
          ? SkillLevel.fromRaw(e.player.hitpoints)
          : undefined;
        const player = new PlayerEntity(
          e.xCoord,
          e.yCoord,
          e.player.name,
          hitpoints,
          /*highlight=*/ e.player.name === selectedPlayer,
        );
        entities.push(player);
        players.push(player);
        break;
      }
      case EventType.NPC_SPAWN:
      case EventType.NPC_UPDATE: {
        const e = evt as NpcEvent;
        if (Npc.isNylocas(e.npc.id)) {
          nylosAlive++;
        }
        entities.push(
          new NpcEntity(
            e.xCoord,
            e.yCoord,
            e.npc.id,
            e.npc.roomId,
            SkillLevel.fromRaw(e.npc.hitpoints),
            getNyloColor(e.npc.id),
          ),
        );
        break;
      }
    }
  }

  const currentWave = (
    eventsByType[EventType.TOB_NYLO_WAVE_SPAWN] as NyloWaveSpawnEvent[]
  )?.findLast((evt) => evt.tick <= currentTick)?.nyloWave;

  const cleanupEvent = eventsByType[EventType.TOB_NYLO_CLEANUP_END]?.at(0);
  const cleanupEnded =
    cleanupEvent !== undefined && cleanupEvent.tick <= currentTick;

  if (currentWave !== undefined && currentWave.wave > 0 && !cleanupEnded) {
    const wave = currentWave.wave;
    const waveTitle = wave < LAST_NYLO_WAVE ? `Wave ${wave}` : 'Cleanup';

    const capColor =
      nylosAlive >= currentWave.roomCap ? 'var(--blert-red)' : 'green';

    const overlay = (
      <div className={styles.waveIndicator}>
        <div>{waveTitle}</div>
        <div className={styles.cap} style={{ color: capColor }}>
          {nylosAlive}/{currentWave.roomCap}
        </div>
      </div>
    );

    entities.push(
      new OverlayEntity(
        NYLOCAS_MAP_DEFINITION.baseX + (display.isCompact() ? 7 : 2),
        NYLOCAS_MAP_DEFINITION.baseY,
        `nylo-wave-${currentWave}-indicator`,
        overlay,
      ),
    );
  }

  const playerTickState = raidData.party.reduce(
    (acc, { username }) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  const stalls =
    eventsByType[EventType.TOB_NYLO_WAVE_STALL]?.map(
      (e) => (e as NyloWaveStallEvent).nyloWave,
    ) ?? [];

  const sections = [];

  if (
    raidData.splits[SplitType.TOB_NYLO_CAP] ||
    raidData.splits[SplitType.TOB_NYLO_WAVES] ||
    raidData.splits[SplitType.TOB_NYLO_CLEANUP] ||
    raidData.splits[SplitType.TOB_NYLO_BOSS_SPAWN]
  ) {
    sections.push({
      title: 'Room Times',
      content: (
        <div className={styles.splits}>
          {raidData.splits[SplitType.TOB_NYLO_CAP] && (
            <Badge
              iconClass="fa-solid fa-hourglass"
              label="Cap"
              value={ticksToFormattedSeconds(
                raidData.splits[SplitType.TOB_NYLO_CAP],
              )}
            />
          )}
          {raidData.splits[SplitType.TOB_NYLO_WAVES] && (
            <Badge
              iconClass="fa-solid fa-hourglass"
              label="Last wave"
              value={ticksToFormattedSeconds(
                raidData.splits[SplitType.TOB_NYLO_WAVES],
              )}
            />
          )}
          {raidData.splits[SplitType.TOB_NYLO_CLEANUP] && (
            <Badge
              iconClass="fa-solid fa-hourglass"
              label="Cleanup"
              value={ticksToFormattedSeconds(
                raidData.splits[SplitType.TOB_NYLO_CLEANUP],
              )}
            />
          )}
          {raidData.splits[SplitType.TOB_NYLO_BOSS_SPAWN] && (
            <Badge
              iconClass="fa-solid fa-hourglass"
              label="Boss"
              value={ticksToFormattedSeconds(
                raidData.splits[SplitType.TOB_NYLO_BOSS_SPAWN],
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

  if (raidData.splits[SplitType.TOB_NYLO_BOSS_SPAWN]) {
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
                      updateTickOnPage(change.tick);
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
                {raidData.tobStats.nylocasBossMelee || 0}
              </span>
              <span className={styles.label}>Melee</span>
            </div>
            <div
              className={styles.bossRotationCount}
              style={{ color: GREEN_NYLO_COLOR }}
            >
              <span className={styles.count}>
                {raidData.tobStats.nylocasBossRanged || 0}
              </span>
              <span className={styles.label}>Ranged</span>
            </div>
            <div
              className={styles.bossRotationCount}
              style={{ color: BLUE_NYLO_COLOR }}
            >
              <span className={styles.count}>
                {raidData.tobStats.nylocasBossMage || 0}
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

  const startingRoomCap = raidData.mode === ChallengeMode.TOB_HARD ? 15 : 12;

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
          updateTickOnPage={updateTickOnPage}
          splits={splits}
          backgroundColors={backgroundColors}
          npcs={npcState}
          smallLegend={display.isCompact()}
        />
      </div>

      <div className={bossStyles.replayAndParty}>
        <BossPageReplay
          entities={entities}
          mapDef={NYLOCAS_MAP_DEFINITION}
          tileSize={display.isCompact() ? 11 : undefined}
        />
        <BossPageParty
          playerTickState={playerTickState}
          selectedPlayer={selectedPlayer}
          setSelectedPlayer={setSelectedPlayer}
        />
      </div>

      <div className={bossStyles.charts}>
        <Card
          className={bossStyles.chart}
          header={{ title: 'Nylos Alive By Tick' }}
        >
          <HorizontalScrollable className={bossStyles.scrollable}>
            <ResponsiveContainer
              width={display.isFull() ? '100%' : 1350}
              height="100%"
            >
              <AreaChart
                data={nylosAliveByTick}
                margin={{ left: -10, bottom: 20 }}
              >
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
                      stopColor="var(--blert-button)"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--blert-button)"
                      stopOpacity={0.05}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--nav-bg-lightened)"
                  opacity={0.9}
                />
                <XAxis
                  dataKey="tick"
                  stroke="var(--font-color-nav)"
                  tickLine={false}
                  axisLine={{ stroke: 'var(--nav-bg-lightened)' }}
                  hide
                />
                <YAxis
                  stroke="var(--font-color-nav)"
                  tickLine={false}
                  axisLine={{ stroke: 'var(--nav-bg-lightened)' }}
                  tickCount={8}
                />
                <Area
                  type="monotone"
                  dataKey="nylosAlive"
                  stroke="rgba(var(--blert-button-base), 0.7)"
                  strokeWidth={2}
                  fill="url(#backgroundGradient)"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--nav-bg)',
                    border: '1px solid var(--nav-bg-lightened)',
                    borderRadius: '8px',
                    color: 'var(--blert-text-color)',
                    padding: '8px',
                  }}
                  formatter={(value: number) => {
                    return [value, 'Nylos Alive'];
                  }}
                  labelFormatter={(tick: number) => {
                    let waveSpawn;
                    const events = eventsByType[
                      EventType.TOB_NYLO_WAVE_SPAWN
                    ] as NyloWaveSpawnEvent[];
                    for (let i = 1; i < events.length; i++) {
                      if (tick < events[i].tick) {
                        waveSpawn = events[i - 1];
                        break;
                      }
                    }
                    if (waveSpawn === undefined) {
                      waveSpawn = events[events.length - 1];
                    }

                    return `Tick: ${tick} (Wave ${waveSpawn.nyloWave.wave})`;
                  }}
                  cursor={{
                    stroke: 'var(--font-color-nav-divider)',
                    strokeWidth: 1,
                  }}
                />
                <ReferenceLine
                  stroke="rgba(var(--blert-red-base), 0.7)"
                  strokeWidth={2}
                  strokeDasharray="2 2"
                  segment={[
                    { x: 0, y: startingRoomCap },
                    {
                      x: raidData.splits[SplitType.TOB_NYLO_CAP],
                      y: startingRoomCap,
                    },
                  ]}
                >
                  <Label
                    position="top"
                    stroke="rgba(var(--blert-text-color-base), 0.7)"
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
                    { x: raidData.splits[SplitType.TOB_NYLO_CAP], y: 24 },
                    { x: raidData.splits[SplitType.TOB_NYLO_CLEANUP], y: 24 },
                  ]}
                >
                  <Label
                    position="top"
                    stroke="rgba(var(--blert-text-color-base), 0.7)"
                    style={{ fontWeight: 200 }}
                  >
                    Room cap
                  </Label>
                </ReferenceLine>
                {eventsByType[EventType.TOB_NYLO_WAVE_SPAWN].map((evt) => {
                  return (
                    <ReferenceLine
                      key={evt.tick}
                      x={evt.tick}
                      stroke={
                        (evt as NyloWaveSpawnEvent).nyloWave.wave === 20
                          ? 'rgba(var(--blert-text-color-base), 0.75)'
                          : 'rgba(var(--blert-text-color-base), 0.15)'
                      }
                      strokeWidth={1}
                    >
                      <Label
                        stroke={
                          (evt as NyloWaveSpawnEvent).nyloWave.wave === 20
                            ? 'rgba(var(--blert-text-color-base), 0.8)'
                            : 'var(--font-color-nav)'
                        }
                        position="bottom"
                        style={{ fontSize: 13, fontWeight: 100 }}
                      >
                        {(evt as NyloWaveSpawnEvent).nyloWave.wave}
                      </Label>
                    </ReferenceLine>
                  );
                })}
                {eventsByType[EventType.TOB_NYLO_WAVE_STALL].map((evt) => {
                  return (
                    <ReferenceLine
                      key={evt.tick}
                      x={evt.tick}
                      stroke="rgba(var(--blert-text-color-base), 0.5)"
                      strokeWidth={2}
                      strokeDasharray="3 3"
                    >
                      <Label
                        stroke="rgba(var(--blert-red-base), 0.7)"
                        position="bottom"
                        style={{ fontSize: 13, fontWeight: 100 }}
                      >
                        {(evt as NyloWaveStallEvent).nyloWave.wave}
                      </Label>
                    </ReferenceLine>
                  );
                })}
              </AreaChart>
            </ResponsiveContainer>
          </HorizontalScrollable>
        </Card>
      </div>

      <BossPageControls
        currentlyPlaying={playing}
        totalTicks={totalTicks}
        currentTick={currentTick}
        updateTick={updateTickOnPage}
        updatePlayingState={setPlaying}
        splits={splits}
      />
    </>
  );
}
