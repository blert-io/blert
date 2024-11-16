'use client';

import {
  BloatDownEvent,
  ChallengeStatus,
  EventType,
  Npc,
  NpcEvent,
  PlayerUpdateEvent,
  SkillLevel,
  Stage,
  TobRaid,
} from '@blert/common';
import Image from 'next/image';
import { useContext, useMemo } from 'react';

import AttackTimeline, { TimelineColor } from '@/components/attack-timeline';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import { BossPageControls } from '@/components/boss-page-controls/boss-page-controls';
import { BossPageDPSTimeline } from '@/components/boss-page-dps-timeine/boss-page-dps-timeline';
import BossPageReplay from '@/components/boss-page-replay';
import CollapsiblePanel from '@/components/collapsible-panel';
import {
  Entity,
  MarkerEntity,
  NpcEntity,
  PlayerEntity,
} from '@/components/map';
import Loading from '@/components/loading';
import Tabs from '@/components/tabs';
import { DisplayContext } from '@/display';
import {
  EnhancedRoomNpc,
  usePlayingState,
  useStageEvents,
} from '@/utils/boss-room-state';
import { ticksToFormattedSeconds } from '@/utils/tick';

import bloatBaseTiles from './bloat-tiles.json';
import bossStyles from '../style.module.scss';
import styles from './style.module.scss';

const BLOAT_MAP_DEFINITION = {
  baseX: 3288,
  baseY: 4440,
  width: 16,
  height: 16,
  baseTiles: bloatBaseTiles,
};

const BLOAT_PILLAR_OUTLINE = new MarkerEntity(3293, 4445, 'white', 6);

type DownInfo = {
  tick: number;
  walkTime: number;
  startHitpoints: SkillLevel | undefined;
  endHitpoints: SkillLevel | undefined;
};

export default function BloatPage() {
  const {
    challenge: raidData,
    totalTicks,
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    loading,
  } = useStageEvents<TobRaid>(Stage.TOB_BLOAT);

  const display = useContext(DisplayContext);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const { downInfo, splits, backgroundColors } = useMemo(() => {
    const bloat: EnhancedRoomNpc | null =
      npcState.values().next().value ?? null;

    const downInfo: DownInfo[] =
      eventsByType[EventType.TOB_BLOAT_DOWN]?.map((evt) => {
        const bloatDownEvent = evt as BloatDownEvent;
        return {
          tick: evt.tick,
          walkTime: bloatDownEvent.bloatDown.walkTime,
          startHitpoints: bloat?.stateByTick[evt.tick]?.hitpoints,
          endHitpoints: undefined,
        };
      }) ?? [];

    let splits = downInfo.map((down, i) => ({
      tick: down.tick,
      splitName: `Down ${i + 1}`,
    }));

    const upColor = 'rgba(100, 56, 70, 0.3)';
    let backgroundColors: TimelineColor[] = [];

    // First up from the start of the room.
    backgroundColors.push({
      tick: 0,
      length: downInfo.length > 0 ? downInfo[0].tick : totalTicks,
      backgroundColor: upColor,
    });

    eventsByType[EventType.TOB_BLOAT_UP]?.forEach((evt, i) => {
      splits.push({ tick: evt.tick, splitName: 'Moving' });

      const nextDownTick =
        downInfo.find((down) => down.tick > evt.tick)?.tick ?? totalTicks;
      backgroundColors.push({
        tick: evt.tick,
        length: nextDownTick - evt.tick,
        backgroundColor: upColor,
      });

      downInfo[i].endHitpoints = bloat?.stateByTick[evt.tick]?.hitpoints;
    });

    if (downInfo.length > 0) {
      downInfo[downInfo.length - 1].endHitpoints =
        bloat?.stateByTick[totalTicks - 1]?.hitpoints;
    }

    return { downInfo, splits, backgroundColors };
  }, [eventsByType, npcState, totalTicks]);

  const bossHealthChartData = useMemo(() => {
    let bloat: EnhancedRoomNpc | null = null;
    let iter = npcState.values();
    for (let npc = iter.next(); !npc.done; npc = iter.next()) {
      if (Npc.isBloat(npc.value.spawnNpcId)) {
        bloat = npcState.get(npc.value.roomId)!;
        break;
      }
    }

    return (
      bloat?.stateByTick.map((state, tick) => ({
        tick,
        bossHealthPercentage: state?.hitpoints.percentage() ?? 0,
      })) ?? []
    );
  }, [npcState]);

  if (loading || raidData === null) {
    return <Loading />;
  }

  const bloatData = raidData.tobRooms.bloat;
  if (raidData.status !== ChallengeStatus.IN_PROGRESS && bloatData === null) {
    return <>No Bloat data for this raid</>;
  }

  const eventsForCurrentTick = eventsByTick[currentTick] ?? [];

  const entities: Entity[] = [BLOAT_PILLAR_OUTLINE];
  const players: PlayerEntity[] = [];

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
        const npc = new NpcEntity(
          e.xCoord,
          e.yCoord,
          e.npc.id,
          e.npc.roomId,
          SkillLevel.fromRaw(e.npc.hitpoints),
        );
        if (
          !entities.some((entity) => entity.getUniqueId() === npc.getUniqueId())
        ) {
          entities.push(npc);
        }
        break;
      }
    }
  }

  const playerTickState = raidData.party.reduce(
    (acc, { username }) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  const downStats = (
    <div className={styles.downs}>
      {downInfo.map((down, i) => (
        <div key={i} className={styles.down}>
          <h3>Down {i + 1}</h3>
          <table>
            <tbody>
              <tr>
                <td>
                  <i
                    className="fa-solid fa-person-walking"
                    style={{ padding: '0 7px 0 3px' }}
                  />
                  <span className="sr-only">Walk time</span>
                </td>
                <td>
                  {ticksToFormattedSeconds(down.walkTime - 1)}
                  <span className={styles.walkTicks}>
                    ({down.walkTime - 1})
                  </span>
                </td>
              </tr>
              <tr>
                <td>
                  <i
                    className="fa-solid fa-heart"
                    style={{ paddingRight: 10 }}
                  />
                  <span className="sr-only">Start hitpoints</span>
                </td>
                <td>
                  {down.startHitpoints
                    ? down.startHitpoints.toPercent(1)
                    : 'Unknown'}
                  {' -> '}
                  {down.endHitpoints
                    ? down.endHitpoints.toPercent(1)
                    : 'Unknown'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );

  const chartWidth = display.isFull() ? 1200 : window?.innerWidth - 40 ?? 350;
  const chartHeight = Math.floor(chartWidth / (display.isCompact() ? 2 : 2.5));
  const healthChart = (
    <div className={bossStyles.chart}>
      <h3>Bloat&apos;s Health By Tick</h3>
      <BossPageDPSTimeline
        currentTick={currentTick}
        data={bossHealthChartData}
        width={chartWidth}
        height={chartHeight}
      />
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
          The Pestilent Bloat ({ticksToFormattedSeconds(totalTicks)})
        </h1>
        <Tabs
          fluid
          maxHeight={maxHeight}
          tabs={[
            {
              icon: 'fas fa-chart-simple',
              content: (
                <div>
                  {downStats}
                  {healthChart}
                </div>
              ),
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
                    mapDef={BLOAT_MAP_DEFINITION}
                    playerTickState={playerTickState}
                    tileSize={20}
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
            src="/bloat.webp"
            alt="The Pestilent Bloat"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={bossStyles.bossPage__KeyDetails}>
          <h2>The Pestilent Bloat ({ticksToFormattedSeconds(totalTicks)})</h2>
          {downStats}
        </div>
      </div>

      <BossPageAttackTimeline
        currentTick={currentTick}
        playing={playing}
        playerState={playerState}
        timelineTicks={totalTicks}
        updateTickOnPage={updateTickOnPage}
        npcs={npcState}
        splits={splits}
        backgroundColors={backgroundColors}
      />

      <CollapsiblePanel
        panelTitle="Room Replay"
        maxPanelHeight={2000}
        defaultExpanded={true}
      >
        <BossPageReplay
          entities={entities}
          mapDef={BLOAT_MAP_DEFINITION}
          playerTickState={playerTickState}
        />
      </CollapsiblePanel>

      <CollapsiblePanel
        panelTitle="Charts"
        maxPanelHeight={1000}
        defaultExpanded
      >
        {healthChart}
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
