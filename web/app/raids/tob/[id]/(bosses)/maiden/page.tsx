'use client';

import Image from 'next/image';
import {
  ChallengeStatus,
  EventType,
  MaidenBloodSplatsEvent,
  MaidenCrabPosition,
  MaidenCrabProperties,
  Npc,
  NpcEvent,
  PlayerUpdateEvent,
  RoomNpcType,
  SkillLevel,
  SplitType,
  Stage,
  TobRaid,
} from '@blert/common';
import { useSearchParams } from 'next/navigation';
import { useContext, useEffect, useMemo } from 'react';

import AttackTimeline, { TimelineSplit } from '@/components/attack-timeline';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import { BossPageControls } from '@/components/boss-page-controls/boss-page-controls';
import BossPageReplay from '@/components/boss-page-replay';
import { BossPageDPSTimeline } from '@/components/boss-page-dps-timeine/boss-page-dps-timeline';
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
  EnhancedMaidenCrab,
  EnhancedRoomNpc,
  usePlayingState,
  useStageEvents,
} from '@/utils/boss-room-state';
import { clamp } from '@/utils/math';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { ActorContext } from '@/raids/tob/context';

import maidenBaseTiles from './maiden.json';
import bossStyles from '../style.module.scss';
import styles from './style.module.scss';
import CollapsiblePanel from '@/components/collapsible-panel';

const MAIDEN_MAP_DEFINITION = {
  baseX: 3160,
  baseY: 4435,
  width: 28,
  height: 24,
  baseTiles: maidenBaseTiles,
};
const BLOOD_SPLAT_COLOR = '#b93e3e';

type CrabSpawnProps = {
  crabs: MaidenCrabProperties[];
  name: string;
  tick: number;
  delta?: number;
};

const SPAWN_SIZE = 25;

function CrabSpawn(props: CrabSpawnProps) {
  const spawns = new Set(props.crabs.map((crab) => crab.position));
  const scuffed = props.crabs.some((crab) => crab.scuffed);

  const crab = (position: MaidenCrabPosition, name: string) =>
    spawns.has(position) ? (
      <div className={styles.presentCrab}>{name}</div>
    ) : (
      <div className={styles.absentCrab} />
    );

  return (
    <div className={styles.spawn}>
      <div className={styles.split}>
        <span className={styles.name}>{props.name}</span> —{' '}
        {ticksToFormattedSeconds(props.tick)}
        {props.delta && (
          <span className={styles.delta}>
            (+{ticksToFormattedSeconds(props.delta)})
          </span>
        )}
      </div>
      <table>
        <tbody>
          <tr>
            <td>
              <table className={styles.spawn}>
                <tbody>
                  <tr>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      {crab(MaidenCrabPosition.S1, 'S1')}
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      &nbsp;
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      &nbsp;
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      &nbsp;
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      {crab(MaidenCrabPosition.N1, 'N1')}
                    </td>
                  </tr>
                  <tr>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      {crab(MaidenCrabPosition.S2, 'S2')}
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      &nbsp;
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      &nbsp;
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      &nbsp;
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      {crab(MaidenCrabPosition.N2, 'N2')}
                    </td>
                  </tr>
                  <tr>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      {crab(MaidenCrabPosition.S3, 'S3')}
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      &nbsp;
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      &nbsp;
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      &nbsp;
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      {crab(MaidenCrabPosition.N3, 'N3')}
                    </td>
                  </tr>
                  <tr>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      {crab(MaidenCrabPosition.S4_OUTER, 'S4')}
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      {crab(MaidenCrabPosition.S4_INNER, 'S4')}
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      &nbsp;
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      {crab(MaidenCrabPosition.N4_INNER, 'N4')}
                    </td>
                    <td width={SPAWN_SIZE} height={SPAWN_SIZE}>
                      {crab(MaidenCrabPosition.N4_OUTER, 'N4')}
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
      {scuffed && <div className={styles.scuffed}>Scuffed</div>}
    </div>
  );
}

export default function Maiden() {
  const searchParams = useSearchParams();
  const display = useContext(DisplayContext);

  const {
    challenge,
    events,
    totalTicks,
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    loading,
  } = useStageEvents<TobRaid>(Stage.TOB_MAIDEN);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const tickParam = searchParams.get('tick');
  let parsedTickParam = 0;
  if (tickParam === null) {
    parsedTickParam = 1;
  } else {
    parsedTickParam = Number.parseInt(tickParam, 10);
    if (Number.isNaN(parsedTickParam)) {
      console.log('Unable to parse param as valid int, defaulting to 1');
      parsedTickParam = 1;
    }
  }

  const finalParsedTickParam = clamp(Math.abs(parsedTickParam), 1, totalTicks);

  useEffect(() => {
    updateTickOnPage(finalParsedTickParam);
  }, [finalParsedTickParam, updateTickOnPage]);

  const bossHealthChartData = useMemo(() => {
    let maiden: EnhancedRoomNpc | null = null;
    let iter = npcState.values();
    for (let npc = iter.next(); !npc.done; npc = iter.next()) {
      if (Npc.isMaiden(npc.value.spawnNpcId)) {
        maiden = npcState.get(npc.value.roomId)!;
        break;
      }
    }

    return (
      maiden?.stateByTick.map((state, tick) => ({
        tick,
        bossHealthPercentage: state?.hitpoints.percentage() ?? 0,
      })) ?? []
    );
  }, [npcState]);

  const { selectedPlayer } = useContext(ActorContext);

  const { splits, spawns } = useMemo(() => {
    const splits: TimelineSplit[] = [];
    const spawns: MaidenCrabProperties[][] = [];

    const addSplits = (tick: number, name: string) => {
      if (tick !== 0) {
        splits.push({ tick, splitName: name });
        const tickEvents = eventsByTick[tick] ?? [];
        const crabs: MaidenCrabProperties[] = [];
        for (const evt of tickEvents) {
          if (evt.type !== EventType.NPC_SPAWN) {
            continue;
          }

          const npc = npcState.get((evt as NpcEvent).npc.roomId);
          if (!npc) {
            continue;
          }

          if (npc.type === RoomNpcType.MAIDEN_CRAB) {
            crabs.push((npc as EnhancedMaidenCrab).maidenCrab);
          }
        }
        spawns.push(crabs);
      }
    };

    if (challenge) {
      addSplits(challenge.splits[SplitType.TOB_MAIDEN_70S] ?? 0, '70s');
      addSplits(challenge.splits[SplitType.TOB_MAIDEN_50S] ?? 0, '50s');
      addSplits(challenge.splits[SplitType.TOB_MAIDEN_30S] ?? 0, '30s');
    }

    return { splits, spawns };
  }, [challenge, eventsByTick, npcState]);

  if (loading || challenge === null) {
    return <Loading />;
  }

  const maidenData = challenge.tobRooms.maiden;
  if (challenge.status === ChallengeStatus.IN_PROGRESS) {
    if (events.length === 0) {
      return <>This raid has not yet started Maiden.</>;
    }
  } else if (maidenData === null) {
    return <>No Maiden data for raid</>;
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
      case EventType.TOB_MAIDEN_BLOOD_SPLATS:
        const e = evt as MaidenBloodSplatsEvent;
        for (const coord of e.maidenBloodSplats ?? []) {
          entities.push(new MarkerEntity(coord.x, coord.y, BLOOD_SPLAT_COLOR));
        }
        break;
    }
  }

  const playerTickState = challenge.party.reduce(
    (acc, { username }) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  const controlsSplits = [];
  if (maidenData !== null && maidenData.ticksLost !== 0) {
    controlsSplits.push({
      tick: maidenData.ticksLost,
      splitName: 'Recording start',
    });
  }
  controlsSplits.push(...splits);

  const crabSpawns = (
    <div className={styles.statsWrapper}>
      {splits.map((split, i) => (
        <CrabSpawn
          key={split.splitName}
          crabs={spawns[i]}
          name={split.splitName}
          tick={split.tick}
          delta={i > 0 ? split.tick - splits[i - 1].tick : undefined}
        />
      ))}
    </div>
  );

  const chartWidth = display.isFull() ? 1200 : window?.innerWidth - 40 ?? 350;
  const chartHeight = Math.floor(chartWidth / (display.isCompact() ? 2 : 2.5));
  const healthChart = (
    <div className={bossStyles.chart}>
      <h3>Maiden&apos;s Health By Tick</h3>
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
          The Maiden of Sugadinti ({ticksToFormattedSeconds(totalTicks)})
        </h1>
        <Tabs
          fluid
          maxHeight={maxHeight}
          tabs={[
            {
              icon: 'fas fa-chart-simple',
              content: (
                <div>
                  {crabSpawns}
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
                    mapDef={MAIDEN_MAP_DEFINITION}
                    playerTickState={playerTickState}
                    tileSize={12}
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
          splits={controlsSplits}
        />
      </div>
    );
  }

  return (
    <>
      <div className={bossStyles.bossPage__Overview}>
        <div className={bossStyles.bossPage__BossPic}>
          <Image
            src="/maiden.webp"
            alt="The Maiden of Sugadinti"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={bossStyles.bossPage__KeyDetails}>
          <h2>
            The Maiden of Sugadinti ({ticksToFormattedSeconds(totalTicks)})
          </h2>
          {crabSpawns}
        </div>
      </div>

      <BossPageAttackTimeline
        currentTick={currentTick}
        playing={playing}
        playerState={playerState}
        timelineTicks={totalTicks}
        updateTickOnPage={updateTickOnPage}
        splits={splits}
        npcs={npcState}
      />

      <CollapsiblePanel
        panelTitle="Room Replay"
        maxPanelHeight={2000}
        defaultExpanded={true}
      >
        <BossPageReplay
          entities={entities}
          mapDef={MAIDEN_MAP_DEFINITION}
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
        splits={controlsSplits}
      />
    </>
  );
}
