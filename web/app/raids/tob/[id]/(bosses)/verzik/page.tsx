'use client';

import { Room } from '@blert/common';
import Image from 'next/image';

import { usePlayingState, useRoomEvents } from '../../../boss-room-state';
import { BossPageControls } from '../../../../../components/boss-page-controls/boss-page-controls';
import { BossPageAttackTimeline } from '../../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';

import styles from './style.module.scss';

export default function VerzikPage() {
  const {
    raidData,
    events,
    totalTicks,
    eventsByTick,
    eventsByType,
    bossAttackTimeline,
    playerAttackTimelines,
  } = useRoomEvents(Room.VERZIK);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  if (raidData === null || events.length === 0) {
    return <>Loading...</>;
  }

  const inventoryTags = false;

  return (
    <>
      <div className={styles.bossPage__Overview}>
        <div className={styles.bossPage__BossPic}>
          <Image
            src="/verzik.webp"
            alt="Verzik Vitur"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={styles.bossPage__KeyDetails}>
          <h2>Verzik Vitur</h2>
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
        updateTickOnPage={updateTickOnPage}
        inventoryTags={inventoryTags}
      />
    </>
  );
}
