'use client';

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
  PlayerEntity,
} from '@/components/map';
import Loading from '@/components/loading';
import { DisplayContext } from '@/display';
import { ActorContext } from '@/(challenges)/raids/tob/context';
import {
  EnhancedMaidenCrab,
  EnhancedRoomNpc,
  usePlayingState,
  useStageEvents,
} from '@/utils/boss-room-state';
import { clamp } from '@/utils/math';
import { ticksToFormattedSeconds } from '@/utils/tick';

import maidenBaseTiles from './maiden.json';
import bossStyles from '../style.module.scss';
import styles from './style.module.scss';

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
  const scuffedCrabs = new Set(
    props.crabs.filter((crab) => crab.scuffed).map((crab) => crab.position),
  );

  const crab = (position: MaidenCrabPosition, name: string) =>
    spawns.has(position) ? (
      <div
        className={`${styles.presentCrab} ${scuffedCrabs.has(position) ? styles.scuffed : ''}`}
      >
        {name}
      </div>
    ) : (
      <div className={styles.absentCrab} />
    );

  return (
    <div className={styles.spawn}>
      <table>
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
      <div className={styles.time}>
        <div>
          <i className="far fa-hourglass" />
          {ticksToFormattedSeconds(props.tick)}
        </div>
        {props.delta && (
          <div className={styles.delta}>
            +{ticksToFormattedSeconds(props.delta)}
          </div>
        )}
      </div>
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

  const { selectedPlayer, setSelectedPlayer } = useContext(ActorContext);

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

  return (
    <>
      <div className={bossStyles.overview}>
        <BossFightOverview
          name="The Maiden of Sugadinti"
          image="/maiden.webp"
          time={totalTicks}
          sections={splits.map((split, i) => ({
            title: `${split.splitName} spawn`,
            content: (
              <CrabSpawn
                key={split.splitName}
                crabs={spawns[i]}
                name={split.splitName}
                tick={split.tick}
                delta={i > 0 ? split.tick - splits[i - 1].tick : undefined}
              />
            ),
          }))}
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
          mapDef={MAIDEN_MAP_DEFINITION}
          tileSize={display.isCompact() ? 12 : undefined}
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
          header={{ title: "Maiden's Health By Tick" }}
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
        splits={controlsSplits}
      />
    </>
  );
}
