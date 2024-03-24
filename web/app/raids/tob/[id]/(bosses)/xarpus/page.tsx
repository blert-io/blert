'use client';

import {
  ChallengeStatus,
  EventType,
  NpcEvent,
  PlayerEvent,
  PlayerUpdateEvent,
  Stage,
  isPlayerEvent,
} from '@blert/common';
import Image from 'next/image';

import {
  getPlayerDetails,
  usePlayingState,
  useRoomEvents,
} from '../../../boss-room-state';
import { BossPageControls } from '../../../../../components/boss-page-controls/boss-page-controls';
import { BossPageAttackTimeline } from '../../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import BossPageReplay from '../../../../../components/boss-page-replay';
import { Entity, NpcEntity, PlayerEntity } from '../../../../../components/map';
import Loading from '../../../../../components/loading';

import styles from './style.module.scss';
import xarpusBaseTiles from './xarpus-tiles.json';
import { useMemo } from 'react';

const XARPUS_MAP_DEFINITION = {
  baseX: 3163,
  baseY: 4380,
  width: 15,
  height: 15,
  baseTiles: xarpusBaseTiles,
};

export default function XarpusPage() {
  const {
    raidData,
    totalTicks,
    eventsByTick,
    eventsByType,
    bossAttackTimeline,
    playerAttackTimelines,
    loading,
  } = useRoomEvents(Stage.TOB_XARPUS);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const splits = useMemo(() => {
    const splits = [];
    const xarpus = raidData?.rooms.xarpus;
    if (xarpus) {
      if (xarpus.splits.exhumes > 0) {
        splits.push({ tick: xarpus.splits.exhumes, splitName: 'Exhumes' });
      }
      if (xarpus.splits.screech > 0) {
        splits.push({ tick: xarpus.splits.screech, splitName: 'Screech' });
      }
    }
    return splits;
  }, [raidData]);

  if (loading || raidData === null) {
    return <Loading />;
  }

  const xarpusData = raidData.rooms.xarpus;
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
        const player = new PlayerEntity(
          e.xCoord,
          e.yCoord,
          e.player.name,
          e.player.hitpoints,
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
            e.npc.hitpoints,
          ),
        );
        break;
      }
    }
  }

  console.log(bossAttackTimeline);

  const playerDetails = getPlayerDetails(
    raidData.party,
    eventsForCurrentTick.filter(isPlayerEvent) as PlayerEvent[],
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

      <BossPageControls
        currentlyPlaying={playing}
        totalTicks={totalTicks}
        currentTick={currentTick}
        updateTick={updateTickOnPage}
        updatePlayingState={setPlaying}
        splits={splits}
      />

      <BossPageAttackTimeline
        currentTick={currentTick}
        playing={playing}
        playerAttackTimelines={playerAttackTimelines}
        bossAttackTimeline={bossAttackTimeline}
        timelineTicks={totalTicks}
        updateTickOnPage={updateTickOnPage}
        npcs={xarpusData?.npcs ?? {}}
        splits={splits}
      />

      <BossPageReplay
        entities={entities}
        mapDef={XARPUS_MAP_DEFINITION}
        playerDetails={playerDetails}
      />
    </>
  );
}
