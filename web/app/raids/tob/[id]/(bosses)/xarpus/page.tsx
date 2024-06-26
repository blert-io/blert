'use client';

import {
  ChallengeStatus,
  EventType,
  NpcEvent,
  PlayerUpdateEvent,
  SkillLevel,
  SplitType,
  Stage,
  TobRaid,
} from '@blert/common';
import Image from 'next/image';
import { useMemo } from 'react';

import { BossPageControls } from '@/components/boss-page-controls/boss-page-controls';
import { BossPageAttackTimeline } from '@/components/boss-page-attack-timeline/boss-page-attack-timeline';
import BossPageReplay from '@/components/boss-page-replay';
import { Entity, NpcEntity, PlayerEntity } from '@/components/map';
import Loading from '@/components/loading';
import { usePlayingState, useStageEvents } from '@/utils/boss-room-state';

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

  return (
    <>
      <div className={styles.bossPage__Overview}>
        <div className={styles.bossPage__BossPic}>
          <Image
            src="/xarpus.webp"
            alt="Xarpus"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={styles.bossPage__KeyDetails}>
          <h2>Xarpus</h2>
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

      <BossPageReplay
        entities={entities}
        mapDef={XARPUS_MAP_DEFINITION}
        playerTickState={playerTickState}
      />

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
