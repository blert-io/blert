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
  XarpusExhumed,
  XarpusExhumedEvent,
} from '@blert/common';
import Image from 'next/image';
import { useContext, useMemo } from 'react';

import { TimelineSplit } from '@/components/attack-timeline';
import BossFightOverview from '@/components/boss-fight-overview';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import BossPageControls from '@/components/boss-page-controls';
import BossPageDPSTimeline from '@/components/boss-page-dps-timeline';
import BossPageParty from '@/components/boss-page-party';
import BossPageReplay from '@/components/boss-page-replay';
import Card from '@/components/card';
import {
  Entity,
  MarkerEntity,
  NpcEntity,
  OverlayEntity,
  PlayerEntity,
} from '@/components/map';
import Loading from '@/components/loading';
import { DisplayContext } from '@/display';
import { ActorContext } from '@/(challenges)/raids/tob/context';
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

function ExhumedOverlay({
  tick,
  exhumed,
}: {
  tick: number;
  exhumed: XarpusExhumed;
}) {
  const healCount = exhumed.healTicks.filter((t) => t <= tick).length;
  const ball = (key: number) => (
    <div
      key={key}
      className={styles.exhumedBall}
      style={{ backgroundColor: '#c7e917' }}
    />
  );

  return (
    <div className={styles.exhumedOverlay}>
      <Image
        src="/images/objects/exhumed.png"
        alt="Xarpus Exhumed"
        fill
        style={{ objectFit: 'contain' }}
      />
      <div className={styles.exhumedHealCount}>
        {healCount < 5 ? (
          Array.from({ length: healCount }).map((_, i) => ball(i))
        ) : (
          <>
            <span>{healCount}×</span>
            {ball(0)}
          </>
        )}
      </div>
    </div>
  );
}

export default function XarpusPage() {
  const display = useContext(DisplayContext);

  const {
    challenge: raidData,
    totalTicks,
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    loading,
  } = useStageEvents<TobRaid>(Stage.TOB_XARPUS);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const { selectedPlayer, setSelectedPlayer } = useContext(ActorContext);

  const splits = useMemo(() => {
    if (raidData === null) {
      return [];
    }

    const splits: TimelineSplit[] = [];
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
          /*highlight=*/ e.player.name === selectedPlayer,
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

  (eventsByType[EventType.TOB_XARPUS_SPLAT] ?? [])
    .filter((evt) => evt.tick <= currentTick)
    .forEach((evt) => {
      entities.push(
        new OverlayEntity(
          evt.xCoord,
          evt.yCoord,
          'splat',
          (
            <Image
              src="/xarpus_spit.png"
              alt="Splat"
              fill
              style={{ objectFit: 'contain' }}
            />
          ),
          /*interactable=*/ false,
          /*size=*/ 1,
          /*customZIndex=*/ 0,
        ),
      );
    });

  const exhumedHealing = {
    none: 0,
    once: 0,
    twice: 0,
    many: 0,
  };
  let healAmount = 0;

  const exhumedEvents = (eventsByType[EventType.TOB_XARPUS_EXHUMED] ??
    []) as XarpusExhumedEvent[];
  for (const evt of exhumedEvents) {
    const exhumed = evt.xarpusExhumed;
    healAmount = exhumed.healAmount;

    if (currentTick >= exhumed.spawnTick && currentTick < evt.tick) {
      entities.push(
        new OverlayEntity(
          evt.xCoord,
          evt.yCoord,
          `exhumed-${exhumed.spawnTick}`,
          <ExhumedOverlay tick={currentTick} exhumed={exhumed} />,
          /*interactable=*/ false,
          /*size=*/ 1,
          /*customZIndex=*/ 0,
        ),
      );
    }

    if (exhumed.healTicks.length === 0) {
      exhumedHealing.none++;
    } else if (exhumed.healTicks.length === 1) {
      exhumedHealing.once++;
    } else if (exhumed.healTicks.length === 2) {
      exhumedHealing.twice++;
    } else {
      exhumedHealing.many++;
    }
  }

  const playerTickState = raidData.party.reduce(
    (acc, { username }) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  const sections = [];

  if (
    raidData.splits[SplitType.TOB_XARPUS_EXHUMES] ||
    raidData.splits[SplitType.TOB_XARPUS_SCREECH]
  ) {
    sections.push({
      title: 'Phase Splits',
      content: (
        <div className={styles.phaseTimes}>
          {raidData.splits[SplitType.TOB_XARPUS_EXHUMES] && (
            <div className={styles.phaseTime}>
              <span className={styles.phaseLabel}>Exhumes:</span>
              <button
                className={styles.phaseValue}
                onClick={() => {
                  updateTickOnPage(
                    raidData.splits[SplitType.TOB_XARPUS_EXHUMES]!,
                  );
                }}
              >
                {ticksToFormattedSeconds(
                  raidData.splits[SplitType.TOB_XARPUS_EXHUMES],
                )}
              </button>
            </div>
          )}
          {raidData.splits[SplitType.TOB_XARPUS_SCREECH] && (
            <div className={styles.phaseTime}>
              <span className={styles.phaseLabel}>Screech:</span>
              <button
                className={styles.phaseValue}
                onClick={() => {
                  updateTickOnPage(
                    raidData.splits[SplitType.TOB_XARPUS_SCREECH]!,
                  );
                }}
              >
                {ticksToFormattedSeconds(
                  raidData.splits[SplitType.TOB_XARPUS_SCREECH],
                )}
              </button>
            </div>
          )}
        </div>
      ),
    });
  }

  if (raidData.tobStats.xarpusHealing !== null) {
    sections.push({
      title: 'Exhumed Healing',
      content: (
        <table className={styles.healingTable}>
          <thead>
            <tr>
              <th colSpan={2} className={styles.healingTableHeader}>
                <i className="fas fa-heart" /> Total Healing:{' '}
                {raidData.tobStats.xarpusHealing}
              </th>
              <th colSpan={2} className={styles.healingTableHeader}>
                <i className="fas fa-splotch" /> Per Splat: {healAmount}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className={styles.healingTableSubHeader}>0 heals</th>
              <th className={styles.healingTableSubHeader}>1 heal</th>
              <th className={styles.healingTableSubHeader}>2 heals</th>
              <th className={styles.healingTableSubHeader}>&gt;2 heals</th>
            </tr>
            <tr>
              <td className={styles.healingTableAmount}>
                {exhumedHealing.none} exh
              </td>
              <td className={styles.healingTableAmount}>
                {exhumedHealing.once} exh
              </td>
              <td className={styles.healingTableAmount}>
                {exhumedHealing.twice} exh
              </td>
              <td className={styles.healingTableAmount}>
                {exhumedHealing.many} exh
              </td>
            </tr>
          </tbody>
        </table>
      ),
    });
  }

  return (
    <>
      <div className={bossStyles.overview}>
        <BossFightOverview
          name="Xarpus"
          className={styles.overview}
          image="/xarpus.webp"
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
          npcs={npcState}
          smallLegend={display.isCompact()}
        />
      </div>

      <div className={bossStyles.replayAndParty}>
        <BossPageReplay
          entities={entities}
          mapDef={XARPUS_MAP_DEFINITION}
          tileSize={display.isCompact() ? 12 : 28}
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
          header={{ title: "Xarpus's Health By Tick" }}
        >
          <BossPageDPSTimeline
            currentTick={currentTick}
            data={bossHealthChartData}
            width="100%"
            height="100%"
          />
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
