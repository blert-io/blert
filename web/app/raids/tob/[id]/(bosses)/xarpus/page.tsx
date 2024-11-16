'use client';

import {
  ChallengeStatus,
  EventType,
  Npc,
  NpcEvent,
  PlayerUpdateEvent,
  SkillLevel,
  SplitType,
  Stage,
  TobRaid,
} from '@blert/common';
import Image from 'next/image';
import { useContext, useMemo } from 'react';

import AttackTimeline from '@/components/attack-timeline';
import { BossPageAttackTimeline } from '@/components/boss-page-attack-timeline/boss-page-attack-timeline';
import { BossPageControls } from '@/components/boss-page-controls/boss-page-controls';
import { BossPageDPSTimeline } from '@/components/boss-page-dps-timeine/boss-page-dps-timeline';
import BossPageReplay from '@/components/boss-page-replay';
import CollapsiblePanel from '@/components/collapsible-panel';
import { Entity, NpcEntity, PlayerEntity } from '@/components/map';
import Loading from '@/components/loading';
import Tabs from '@/components/tabs';
import { DisplayContext } from '@/display';
import {
  EnhancedRoomNpc,
  usePlayingState,
  useStageEvents,
} from '@/utils/boss-room-state';
import { ticksToFormattedSeconds } from '@/utils/tick';

import bossStyles from '../style.module.scss';
import styles from './style.module.scss';
import xarpusBaseTiles from './xarpus-tiles.json';

const XARPUS_MAP_DEFINITION = {
  baseX: 3163,
  baseY: 4380,
  width: 15,
  height: 15,
  baseTiles: xarpusBaseTiles,
};

export default function XarpusPage() {
  const {
    challenge: raidData,
    totalTicks,
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    loading,
  } = useStageEvents<TobRaid>(Stage.TOB_XARPUS);

  const display = useContext(DisplayContext);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const splits = useMemo(() => {
    if (raidData === null) {
      return [];
    }

    const splits = [];
    if (raidData.splits[SplitType.TOB_XARPUS_EXHUMES]) {
      splits.push({
        tick: raidData.splits[SplitType.TOB_XARPUS_EXHUMES],
        splitName: 'Exhumes',
      });
    }
    if (raidData.splits[SplitType.TOB_XARPUS_SCREECH]) {
      splits.push({
        tick: raidData.splits[SplitType.TOB_XARPUS_SCREECH],
        splitName: 'Screech',
      });
    }
    return splits;
  }, [raidData]);

  const bossHealthChartData = useMemo(() => {
    let xarpus: EnhancedRoomNpc | null = null;
    let iter = npcState.values();
    for (let npc = iter.next(); !npc.done; npc = iter.next()) {
      if (Npc.isXarpus(npc.value.spawnNpcId)) {
        xarpus = npcState.get(npc.value.roomId)!;
        break;
      }
    }

    return (
      xarpus?.stateByTick.map((state, tick) => ({
        tick,
        bossHealthPercentage: state?.hitpoints.percentage() ?? 0,
      })) ?? []
    );
  }, [npcState]);

  if (loading || raidData === null) {
    return <Loading />;
  }

  const xarpusData = raidData.tobRooms.xarpus;
  if (raidData.status != ChallengeStatus.IN_PROGRESS && xarpusData === null) {
    return <>No Xarpus data for this raid</>;
  }

  const eventsForCurrentTick = eventsByTick[currentTick] ?? [];

  const entities: Entity[] = [];
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
        entities.push(
          new NpcEntity(
            e.xCoord,
            e.yCoord,
            e.npc.id,
            e.npc.roomId,
            SkillLevel.fromRaw(e.npc.hitpoints),
          ),
        );
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

  const chartWidth = display.isFull() ? 1200 : window?.innerWidth - 40 ?? 350;
  const chartHeight = Math.floor(chartWidth / (display.isCompact() ? 2 : 2.5));
  const healthChart = (
    <div className={bossStyles.chart}>
      <h3>Xarpus&apos;s Health By Tick</h3>
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
          Xarpus ({ticksToFormattedSeconds(totalTicks)})
        </h1>
        <Tabs
          fluid
          maxHeight={maxHeight}
          tabs={[
            {
              icon: 'fas fa-chart-simple',
              content: <div>{healthChart}</div>,
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
                    mapDef={XARPUS_MAP_DEFINITION}
                    playerTickState={playerTickState}
                    tileSize={22}
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
            src="/xarpus.webp"
            alt="Xarpus"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={bossStyles.bossPage__KeyDetails}>
          <h2>Xarpus ({ticksToFormattedSeconds(totalTicks)})</h2>
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
      />

      <CollapsiblePanel
        panelTitle="Room Replay"
        maxPanelHeight={2000}
        defaultExpanded={true}
      >
        <BossPageReplay
          entities={entities}
          mapDef={XARPUS_MAP_DEFINITION}
          tileSize={35}
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
