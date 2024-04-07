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
  SkillLevel,
  Stage,
} from '@blert/common';
import { useContext, useEffect, useMemo } from 'react';

import { TimelineSplit } from '../../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import { useSearchParams } from 'next/navigation';
import { BossPageAttackTimeline } from '../../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import { BossPageControls } from '../../../../../components/boss-page-controls/boss-page-controls';
import BossPageReplay from '../../../../../components/boss-page-replay';
import { BossPageDPSTimeline } from '../../../../../components/boss-page-dps-timeine/boss-page-dps-timeline';
import {
  Entity,
  MarkerEntity,
  NpcEntity,
  PlayerEntity,
} from '../../../../../components/map';
import {
  EnhancedRoomNpc,
  usePlayingState,
  useRoomEvents,
} from '../../../../../utils/boss-room-state';
import { clamp } from '../../../../../utils/math';
import { ActorContext, RaidContext } from '../../../context';
import Loading from '../../../../../components/loading';
import { ticksToFormattedSeconds } from '../../../../../utils/tick';

import maidenBaseTiles from './maiden.json';
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

  const {
    challenge,
    events,
    totalTicks,
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    loading,
  } = useRoomEvents(RaidContext, Stage.TOB_MAIDEN);

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
        bossHealthPercentage: state?.hitpoints.percent() ?? 0,
      })) ?? []
    );
  }, [npcState]);

  const { selectedPlayer } = useContext(ActorContext);

  const { splits, spawns } = useMemo(() => {
    const splits: TimelineSplit[] = [];
    const spawns: MaidenCrabProperties[][] = [];
    const maidenRoom = challenge?.tobRooms.maiden;

    const addSplits = (tick: number, name: string) => {
      if (tick !== 0) {
        splits.push({ tick, splitName: name });
        const tickEvents = eventsByTick[tick];
        if (tickEvents) {
          spawns.push(
            tickEvents
              .filter(
                (e) =>
                  e.type === EventType.NPC_SPAWN &&
                  (e as NpcEvent).npc.maidenCrab !== undefined,
              )
              .map((e) => (e as NpcEvent).npc.maidenCrab!),
          );
        }
      }
    };

    if (maidenRoom) {
      addSplits(maidenRoom.splits.SEVENTIES, '70s');
      addSplits(maidenRoom.splits.FIFTIES, '50s');
      addSplits(maidenRoom.splits.THIRTIES, '30s');
    }

    return { splits, spawns };
  }, [challenge, eventsByTick]);

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
    (acc, username) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  const controlsSplits = [];
  if (maidenData !== null && maidenData.firstTick !== 0) {
    controlsSplits.push({
      tick: maidenData.firstTick,
      splitName: 'Recording start',
    });
  }
  controlsSplits.push(...splits);

  return (
    <>
      <div className={styles.bossPage__Overview}>
        <div className={styles.bossPage__BossPic}>
          <Image
            src="/maiden.webp"
            alt="The Maiden of Sugadinti"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={styles.bossPage__KeyDetails}>
          <h2>
            The Maiden of Sugadinti ({ticksToFormattedSeconds(totalTicks)})
          </h2>
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

      <BossPageReplay
        entities={entities}
        mapDef={MAIDEN_MAP_DEFINITION}
        playerTickState={playerTickState}
      />

      <BossPageDPSTimeline
        currentTick={currentTick}
        data={bossHealthChartData}
      />

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
