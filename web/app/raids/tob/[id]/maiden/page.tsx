'use client';

import Image from 'next/image';
import {
  Event,
  EventType,
  MaidenBloodSplatsEvent,
  NpcEvent,
  PlayerUpdateEvent,
  Room,
} from '@blert/common';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

import { BossPageAttackTimeline } from '../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import { BossPageControls } from '../../../../components/boss-page-controls/boss-page-controls';
import BossPageReplay from '../../../../components/boss-page-replay';
import { BossPageDPSTimeline } from '../../../../components/boss-page-dps-timeine/boss-page-dps-timeline';
import {
  Entity,
  MarkerEntity,
  NpcEntity,
  PlayerEntity,
} from '../../../../components/map';

import { clamp } from '../../../../utils/math';
import { usePlayingState, useRoomEvents } from '../../boss-room-state';

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

export default function Maiden({ params: { id } }: { params: { id: string } }) {
  const searchParams = useSearchParams();

  const {
    raidData,
    events,
    totalTicks,
    eventsByTick,
    eventsByType,
    bossAttackTimeline,
    playerAttackTimelines,
  } = useRoomEvents(Room.MAIDEN);

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

  const memesToApply = searchParams.get('memes')?.split(',') ?? [];
  const inventoryTags = memesToApply.includes('invtags');

  const finalParsedTickParam = clamp(Math.abs(parsedTickParam), 1, totalTicks);

  useEffect(() => {
    updateTickOnPage(finalParsedTickParam);
  }, [finalParsedTickParam]);

  if (raidData === null || events.length === 0) {
    return <>Loading...</>;
  }

  console.log(raidData);

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
      case EventType.MAIDEN_BLOOD_SPLATS:
        const e = evt as MaidenBloodSplatsEvent;
        for (const coord of e.maidenBloodSplats ?? []) {
          entities.push(new MarkerEntity(coord.x, coord.y, BLOOD_SPLAT_COLOR));
        }
        break;
    }
  }

  return (
    <div className={styles.bossPage}>
      <div className={styles.bossPage__Inner}>
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
            <h2>The Maiden of Sugondeez</h2>
          </div>
        </div>

        <BossPageControls
          currentlyPlaying={playing}
          totalTicks={totalTicks}
          currentTick={currentTick}
          updateTick={updateTickOnPage}
          updatePlayingState={setPlaying}
        />

        <BossPageAttackTimeline
          currentTick={currentTick}
          playing={playing}
          playerAttackTimelines={playerAttackTimelines}
          bossAttackTimeline={bossAttackTimeline}
          timelineTicks={totalTicks}
          inventoryTags={inventoryTags}
        />

        <BossPageReplay entities={entities} mapDef={MAIDEN_MAP_DEFINITION} />

        <BossPageDPSTimeline />
      </div>
    </div>
  );
}
