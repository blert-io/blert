'use client';

import {
  ChallengeStatus,
  EventType,
  NpcEvent,
  PlayerEvent,
  PlayerUpdateEvent,
  Room,
  isPlayerEvent,
} from '@blert/common';
import Image from 'next/image';

import {
  getPlayerDetails,
  usePlayingState,
  useRoomEvents,
} from '../../../boss-room-state';
import { BossPageControls } from '../../../../../components/boss-page-controls/boss-page-controls';
import {
  BossPageAttackTimeline,
  TimelineColor,
} from '../../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import BossPageReplay from '../../../../../components/boss-page-replay';
import {
  Entity,
  MarkerEntity,
  NpcEntity,
  PlayerEntity,
} from '../../../../../components/map';
import Loading from '../../../../../components/loading';

import bloatBaseTiles from './bloat-tiles.json';
import styles from './style.module.scss';
import { ticksToFormattedSeconds } from '../../../../../utils/tick';

const BLOAT_MAP_DEFINITION = {
  baseX: 3288,
  baseY: 4440,
  width: 16,
  height: 16,
  baseTiles: bloatBaseTiles,
};

const BLOAT_PILLAR_OUTLINE = new MarkerEntity(3293, 4445, 'white', 6);

export default function BloatPage() {
  const {
    raidData,
    totalTicks,
    eventsByTick,
    eventsByType,
    bossAttackTimeline,
    playerAttackTimelines,
    loading,
  } = useRoomEvents(Room.BLOAT);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  if (loading || raidData === null) {
    return <Loading />;
  }

  const bloatData = raidData.rooms[Room.BLOAT];
  if (raidData.status !== ChallengeStatus.IN_PROGRESS && bloatData === null) {
    return <>No Bloat data for this raid</>;
  }

  const eventsForCurrentTick = eventsByTick[currentTick] ?? [];

  const entities: Entity[] = [BLOAT_PILLAR_OUTLINE];
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

  const downTicks =
    eventsByType[EventType.BLOAT_DOWN]?.map((evt) => evt.tick) ?? [];
  let splits = downTicks.map((tick, i) => ({
    tick,
    splitName: `Down ${i + 1}`,
  }));

  const upColor = 'rgba(100, 56, 70, 0.3)';
  let backgroundColors: TimelineColor[] = [];

  // First up from the start of the room.
  backgroundColors.push({
    tick: 0,
    length: downTicks.length > 0 ? downTicks[0] : totalTicks,
    backgroundColor: upColor,
  });

  eventsByType[EventType.BLOAT_UP]?.forEach((evt) => {
    splits.push({ tick: evt.tick, splitName: 'Moving' });

    const nextDownTick =
      downTicks.find((tick) => tick > evt.tick) ?? totalTicks;
    backgroundColors.push({
      tick: evt.tick,
      length: nextDownTick - evt.tick,
      backgroundColor: upColor,
    });
  });

  const playerDetails = getPlayerDetails(
    raidData.party,
    eventsForCurrentTick.filter(isPlayerEvent) as PlayerEvent[],
  );

  return (
    <>
      <div className={styles.bossPage__Overview}>
        <div className={styles.bossPage__BossPic}>
          <Image
            src="/bloat.webp"
            alt="The Pestilent Bloat"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={styles.bossPage__KeyDetails}>
          <h2>The Pestilent Bloat ({ticksToFormattedSeconds(totalTicks)})</h2>
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
        npcs={bloatData?.npcs ?? {}}
        splits={splits}
        backgroundColors={backgroundColors}
      />

      <BossPageReplay
        entities={entities}
        mapDef={BLOAT_MAP_DEFINITION}
        playerDetails={playerDetails}
      />
    </>
  );
}
