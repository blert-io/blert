'use client';

import {
  ChallengeStatus,
  EventType,
  Npc,
  SplitType,
  Stage,
  TobRaid,
  XarpusExhumedEvent,
} from '@blert/common';
import { useCallback, useContext, useMemo } from 'react';

import { TimelineSplit } from '@/components/attack-timeline';
import BossFightOverview from '@/components/boss-fight-overview';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import BossPageControls from '@/components/boss-page-controls';
import BossPageDPSTimeline from '@/components/boss-page-dps-timeline';
import BossPageParty from '@/components/boss-page-party';
import BossPageReplay from '@/components/boss-page-replay';
import Card from '@/components/card';
import {
  AnyEntity,
  MapDefinition,
  ObjectEntity,
} from '@/components/map-renderer';
import Loading from '@/components/loading';
import { DisplayContext } from '@/display';
import { ActorContext } from '@/(challenges)/raids/tob/context';
import {
  EnhancedRoomNpc,
  useMapEntities,
  usePlayingState,
  useStageEvents,
} from '@/utils/boss-room-state';
import { ticksToFormattedSeconds } from '@/utils/tick';

import BarrierEntity from '../barrier';
import {
  ExhumedEntity,
  PoisonBallEntity,
  ExhumedState,
} from './exhumed-entity';

import bossStyles from '../style.module.scss';
import styles from './style.module.scss';

const XARPUS_MAP_DEFINITION: MapDefinition = {
  baseX: 3154,
  baseY: 4372,
  width: 32,
  height: 32,
  plane: 1,
};

const MAP_CENTER = { x: 3170, y: 4387 };
const BARRIERS = [
  new BarrierEntity({ x: 3170, y: 4380 }, 3),
  new BarrierEntity({ x: 3170, y: 4395 }, 3, Math.PI),
];

export default function XarpusPage() {
  const display = useContext(DisplayContext);

  const compact = display.isCompact();

  const mapDefinition = useMemo(() => {
    const initialZoom = compact ? 19 : 28;
    return {
      ...XARPUS_MAP_DEFINITION,
      initialZoom,
    };
  }, [compact]);

  const {
    challenge,
    totalTicks,
    eventsByType,
    playerState,
    npcState,
    loading,
  } = useStageEvents<TobRaid>(Stage.TOB_XARPUS);

  const { currentTick, setTick, playing, setPlaying, advanceTick } =
    usePlayingState(totalTicks);

  const { selectedPlayer, setSelectedPlayer } = useContext(ActorContext);

  const splits = useMemo(() => {
    if (challenge === null) {
      return [];
    }

    const splits: TimelineSplit[] = [];
    if (challenge.splits[SplitType.TOB_XARPUS_EXHUMES]) {
      splits.push({
        tick: challenge.splits[SplitType.TOB_XARPUS_EXHUMES],
        splitName: 'Exhumes',
      });
    }
    if (challenge.splits[SplitType.TOB_XARPUS_SCREECH]) {
      splits.push({
        tick: challenge.splits[SplitType.TOB_XARPUS_SCREECH],
        splitName: 'Screech',
      });
    }
    return splits;
  }, [challenge]);

  const bossHealthChartData = useMemo(() => {
    let xarpus: EnhancedRoomNpc | null = null;
    const iter = npcState.values();
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

  const customEntitiesForTick = useCallback(
    (tick: number) => {
      const entities: AnyEntity[] = [...BARRIERS];

      entities.push(
        ...(eventsByType[EventType.TOB_XARPUS_SPLAT] ?? [])
          .filter((evt) => evt.tick <= tick)
          .map(
            (evt) =>
              new ObjectEntity(
                { x: evt.xCoord, y: evt.yCoord },
                '/xarpus_spit.png',
                'Xarpus Splat',
                1,
                /*borderColor=*/ undefined,
                /*layFlat=*/ true,
              ),
          ),
      );

      const exhumedEvents = eventsByType[EventType.TOB_XARPUS_EXHUMED] ?? [];
      for (const evt of exhumedEvents) {
        const exhumed = (evt as XarpusExhumedEvent).xarpusExhumed;
        const spawnTick = exhumed.spawnTick;
        const deathTick = evt.tick;

        if (tick >= spawnTick && tick <= deathTick) {
          let state: ExhumedState;

          if (tick === spawnTick) {
            state = ExhumedState.RISING;
          } else if (tick === deathTick) {
            state = ExhumedState.RECEDING;
          } else {
            state = ExhumedState.ACTIVE;
          }

          const healCount = exhumed.healTicks.filter((t) => t <= tick).length;

          entities.push(
            new ExhumedEntity(
              { x: evt.xCoord, y: evt.yCoord },
              state,
              healCount,
            ),
          );
        }
      }

      const balls = exhumedEvents.flatMap((evt) => {
        const exhumed = (evt as XarpusExhumedEvent).xarpusExhumed;
        return exhumed.healTicks
          .filter((t) => t === tick)
          .map(
            (_) =>
              new PoisonBallEntity(
                { x: evt.xCoord, y: evt.yCoord },
                MAP_CENTER,
              ),
          );
      });

      entities.push(...balls);

      return entities;
    },
    [eventsByType],
  );

  const { entitiesByTick, preloads } = useMapEntities(
    challenge,
    playerState,
    npcState,
    totalTicks,
    { customEntitiesForTick },
  );

  if (loading || challenge === null) {
    return <Loading />;
  }

  const xarpusData = challenge.tobRooms.xarpus;
  if (challenge.status != ChallengeStatus.IN_PROGRESS && xarpusData === null) {
    return <>No Xarpus data for this raid</>;
  }

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

  const playerTickState = challenge.party.reduce(
    (acc, { username }) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  const sections = [];

  if (
    challenge.splits[SplitType.TOB_XARPUS_EXHUMES] ||
    challenge.splits[SplitType.TOB_XARPUS_SCREECH]
  ) {
    sections.push({
      title: 'Phase Splits',
      content: (
        <div className={styles.phaseTimes}>
          {challenge.splits[SplitType.TOB_XARPUS_EXHUMES] && (
            <div className={styles.phaseTime}>
              <span className={styles.phaseLabel}>Exhumes:</span>
              <button
                className={styles.phaseValue}
                onClick={() => {
                  setTick(challenge.splits[SplitType.TOB_XARPUS_EXHUMES]!);
                }}
              >
                {ticksToFormattedSeconds(
                  challenge.splits[SplitType.TOB_XARPUS_EXHUMES],
                )}
              </button>
            </div>
          )}
          {challenge.splits[SplitType.TOB_XARPUS_SCREECH] && (
            <div className={styles.phaseTime}>
              <span className={styles.phaseLabel}>Screech:</span>
              <button
                className={styles.phaseValue}
                onClick={() => {
                  setTick(challenge.splits[SplitType.TOB_XARPUS_SCREECH]!);
                }}
              >
                {ticksToFormattedSeconds(
                  challenge.splits[SplitType.TOB_XARPUS_SCREECH],
                )}
              </button>
            </div>
          )}
        </div>
      ),
    });
  }

  if (challenge.tobStats.xarpusHealing !== null) {
    sections.push({
      title: 'Exhumed Healing',
      content: (
        <table className={styles.healingTable}>
          <thead>
            <tr>
              <th colSpan={2} className={styles.healingTableHeader}>
                <i className="fas fa-heart" /> Total Healing:{' '}
                {challenge.tobStats.xarpusHealing}
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
          updateTickOnPage={setTick}
          splits={splits}
          npcs={npcState}
          smallLegend={display.isCompact()}
        />
      </div>

      <div className={bossStyles.replayAndParty}>
        <BossPageReplay
          entities={entitiesByTick.get(currentTick) ?? []}
          preloads={preloads}
          mapDef={mapDefinition}
          playing={playing}
          width={compact ? 330 : 540}
          height={compact ? 330 : 540}
          currentTick={currentTick}
          advanceTick={advanceTick}
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
        updateTick={setTick}
        updatePlayingState={setPlaying}
        splits={splits}
      />
    </>
  );
}
