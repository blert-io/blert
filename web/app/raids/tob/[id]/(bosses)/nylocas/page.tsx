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
} from '@blert/common';
import Image from 'next/image';
import { useContext, useMemo } from 'react';

import Badge from '@/components/badge';
import {
  EventTickMap,
  usePlayingState,
  useStageEvents,
} from '@/utils/boss-room-state';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import AttackTimeline, {
  TimelineColor,
  TimelineSplit,
} from '@/components/attack-timeline';
import { BossPageControls } from '@/components/boss-page-controls/boss-page-controls';
import BossPageReplay from '@/components/boss-page-replay';
import CollapsiblePanel from '@/components/collapsible-panel';
import HorizontalScrollable from '@/components/horizontal-scrollable';
import Loading from '@/components/loading';
import { Entity, NpcEntity, PlayerEntity } from '@/components/map';
import { OverlayEntity } from '@/components/map/overlay';
import Tabs from '@/components/tabs';
import { DisplayContext } from '@/display';
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

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

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

  const stats = (
    <div>
      <div className={styles.splits}>
        {raidData.splits[SplitType.TOB_NYLO_CAP] && (
          <Badge
            className={styles.split}
            iconClass="fa-solid fa-hourglass"
            label="Cap"
            value={ticksToFormattedSeconds(
              raidData.splits[SplitType.TOB_NYLO_CAP],
            )}
          />
        )}
        {raidData.splits[SplitType.TOB_NYLO_WAVES] && (
          <Badge
            className={styles.split}
            iconClass="fa-solid fa-hourglass"
            label="Last wave"
            value={ticksToFormattedSeconds(
              raidData.splits[SplitType.TOB_NYLO_WAVES],
            )}
          />
        )}
        {raidData.splits[SplitType.TOB_NYLO_CLEANUP] && (
          <Badge
            className={styles.split}
            iconClass="fa-solid fa-hourglass"
            label="Cleanup"
            value={ticksToFormattedSeconds(
              raidData.splits[SplitType.TOB_NYLO_CLEANUP],
            )}
          />
        )}
        {raidData.splits[SplitType.TOB_NYLO_BOSS_SPAWN] && (
          <Badge
            className={styles.split}
            iconClass="fa-solid fa-hourglass"
            label="Boss"
            value={ticksToFormattedSeconds(
              raidData.splits[SplitType.TOB_NYLO_BOSS_SPAWN],
            )}
          />
        )}
      </div>
      <div className={styles.splitCounts}>
        <h3 className={styles.statsHeading}>Splits</h3>
        <div className={styles.splitCountGroup}>
          <span className={styles.heading}>Pre-cap</span>
          <span
            className={styles.splitCount}
            style={{ color: BLUE_NYLO_COLOR }}
          >
            {nyloSplits.preCap.mage}
          </span>
          <span className={styles.divider}>|</span>
          <span
            className={styles.splitCount}
            style={{ color: GREEN_NYLO_COLOR }}
          >
            {nyloSplits.preCap.ranged}
          </span>
          <span className={styles.divider}>|</span>
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
          <span className={styles.divider}>|</span>
          <span
            className={styles.splitCount}
            style={{ color: GREEN_NYLO_COLOR }}
          >
            {nyloSplits.postCap.ranged}
          </span>
          <span className={styles.divider}>|</span>
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
          <span className={styles.divider}>|</span>
          <span
            className={styles.splitCount}
            style={{ color: GREEN_NYLO_COLOR }}
          >
            {nyloSplits.preCap.ranged + nyloSplits.postCap.ranged}
          </span>
          <span className={styles.divider}>|</span>
          <span
            className={styles.splitCount}
            style={{ color: GRAY_NYLO_COLOR }}
          >
            {nyloSplits.preCap.melee + nyloSplits.postCap.melee}
          </span>
        </div>
      </div>
      {raidData.splits[SplitType.TOB_NYLO_BOSS_SPAWN] && (
        <div className={styles.bossRotation}>
          <h3 className={styles.statsHeading}>Boss rotation:</h3>
          <div className={styles.splitCountGroup}>
            <span
              className={styles.splitCount}
              style={{ color: BLUE_NYLO_COLOR }}
            >
              {raidData.tobStats.nylocasBossMage}
            </span>
            <span className={styles.divider}>|</span>
            <span
              className={styles.splitCount}
              style={{ color: GREEN_NYLO_COLOR }}
            >
              {raidData.tobStats.nylocasBossRanged}
            </span>
            <span className={styles.divider}>|</span>
            <span
              className={styles.splitCount}
              style={{ color: GRAY_NYLO_COLOR }}
            >
              {raidData.tobStats.nylocasBossMelee}
            </span>
          </div>
        </div>
      )}
      <h3 className={styles.statsHeading}>Stalled Waves ({stalls.length})</h3>
      <HorizontalScrollable className={styles.stalls}>
        {stalls.map((stall, i) => (
          <div key={i} className={styles.stall}>
            <span className={styles.wave}>{stall.wave}</span>
            <span className={styles.nylos}>
              {stall.nylosAlive}/{stall.roomCap}
            </span>
          </div>
        ))}
      </HorizontalScrollable>
    </div>
  );

  if (display.isCompact()) {
    let maxHeight;
    let timelineWrapWidth = 380;
    if (window) {
      maxHeight = window.innerHeight - 255;
      timelineWrapWidth = window.innerWidth - 25;
    }

    return (
      <div className={bossStyles.bossPageCompact}>
        <h1>
          <i className="fas fa-bullseye" />
          The Nylocas ({ticksToFormattedSeconds(totalTicks)})
        </h1>
        <Tabs
          fluid
          maxHeight={maxHeight}
          tabs={[
            {
              icon: 'fas fa-chart-simple',
              content: <div>{stats}</div>,
            },
            {
              icon: 'fas fa-timeline',
              content: (
                <div className={bossStyles.timeline}>
                  <AttackTimeline
                    currentTick={currentTick}
                    playing={playing}
                    playerState={playerState}
                    timelineTicks={totalTicks}
                    updateTickOnPage={updateTickOnPage}
                    splits={splits}
                    npcs={npcState}
                    cellSize={20}
                    wrapWidth={timelineWrapWidth}
                    smallLegend
                  />
                </div>
              ),
            },
            {
              icon: 'fas fa-gamepad',
              content: (
                <div>
                  <BossPageReplay
                    entities={entities}
                    mapDef={NYLOCAS_MAP_DEFINITION}
                    playerTickState={playerTickState}
                    tileSize={11}
                  />
                </div>
              ),
            },
          ]}
        />
        <BossPageControls
          currentlyPlaying={playing}
          totalTicks={totalTicks}
          currentTick={currentTick}
          updateTick={updateTickOnPage}
          updatePlayingState={setPlaying}
          splits={splits}
        />
      </div>
    );
  }

  return (
    <>
      <div className={bossStyles.bossPage__Overview}>
        <div className={bossStyles.bossPage__BossPic}>
          <Image
            src="/nyloking.webp"
            alt="Nylocas Vasilias"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={bossStyles.bossPage__KeyDetails}>
          <h2>The Nylocas ({ticksToFormattedSeconds(totalTicks)})</h2>
          {stats}
        </div>
      </div>

      <BossPageAttackTimeline
        currentTick={currentTick}
        playing={playing}
        playerState={playerState}
        timelineTicks={totalTicks}
        updateTickOnPage={updateTickOnPage}
        splits={splits}
        backgroundColors={backgroundColors}
        npcs={npcState}
      />

      <CollapsiblePanel
        panelTitle="Room Replay"
        maxPanelHeight={2000}
        defaultExpanded={true}
      >
        <BossPageReplay
          entities={entities}
          mapDef={NYLOCAS_MAP_DEFINITION}
          playerTickState={playerTickState}
        />
      </CollapsiblePanel>

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
