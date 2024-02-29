'use client';

import { Room } from '@blert/common';

import { usePlayingState, useRoomEvents } from '../../boss-room-state';
import { BossPageControls } from '../../../../components/boss-page-controls/boss-page-controls';
import { BossPageAttackTimeline } from '../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';

export default function BloatPage() {
  const {
    raidData,
    events,
    totalTicks,
    eventsByTick,
    eventsByType,
    bossAttackTimeline,
    playerAttackTimelines,
  } = useRoomEvents(Room.BLOAT);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  console.log(bossAttackTimeline);

  if (raidData === null || events.length === 0) {
    return <>Loading...</>;
  }

  const inventoryTags = false;

  return (
    <div>
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
    </div>
  );
}
