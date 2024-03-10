'use client';

import {
  EventType,
  NpcEvent,
  PlayerEvent,
  PlayerUpdateEvent,
  RaidStatus,
  Room,
  isPlayerEvent,
} from '@blert/common';
import Image from 'next/image';
import { useContext } from 'react';
import { SOTETSEG } from '../../../../../bosses/tob';
import {
  getPlayerDetails,
  usePlayingState,
  useRoomEvents,
} from '../../../boss-room-state';
import { BossPageControls } from '../../../../../components/boss-page-controls/boss-page-controls';
import { BossPageAttackTimeline } from '../../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import BossPageReplay from '../../../../../components/boss-page-replay';
import {
  Entity,
  NpcEntity,
  OverlayEntity,
  PlayerEntity,
} from '../../../../../components/map';
import { MemeContext } from '../../../../meme-context';

import styles from './style.module.scss';
import soteBaseTiles from './sote-tiles.json';

const SOTETSEG_MAP_DEFINITION = {
  baseX: 3272,
  baseY: 4305,
  width: 16,
  height: 28,
  baseTiles: soteBaseTiles,
};

const MAZE_START_X = 3273;
const MAZE_START_Y = 4310;
const MAZE_WIDTH = 14;
const MAZE_HEIGHT = 15;

export default function SotetsegPage() {
  const {
    raidData,
    events,
    totalTicks,
    eventsByTick,
    eventsByType,
    bossAttackTimeline,
    playerAttackTimelines,
  } = useRoomEvents(Room.SOTETSEG);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const memes = useContext(MemeContext);

  if (raidData === null || events.length === 0) {
    return <>Loading...</>;
  }

  const soteData = raidData.rooms[Room.SOTETSEG];
  if (raidData.status !== RaidStatus.IN_PROGRESS && soteData === null) {
    return <>No Sotetseg data for this raid</>;
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

  // Render tiles for the maze.
  const mazeTileOverlay = (
    <div className={styles.mapTile}>
      <div className={styles.circle} />
    </div>
  );
  for (let y = MAZE_START_Y; y < MAZE_START_Y + MAZE_HEIGHT; ++y) {
    for (let x = MAZE_START_X; x < MAZE_START_X + MAZE_WIDTH; ++x) {
      entities.push(
        new OverlayEntity(x, y, `maze-tile-${x}-${y}`, mazeTileOverlay, false),
      );
    }
  }

  let splits = [];
  if (soteData !== null) {
    if (soteData.splits.MAZE_66) {
      splits.push({
        tick: soteData.splits.MAZE_66,
        splitName: '66%',
      });
    }
    if (soteData.splits.MAZE_33) {
      splits.push({
        tick: soteData.splits.MAZE_33,
        splitName: '33%',
      });
    }
  }

  const playerDetails = getPlayerDetails(
    raidData.party,
    eventsForCurrentTick.filter(isPlayerEvent) as PlayerEvent[],
  );

  return (
    <>
      <div className={styles.bossPage__Overview}>
        <div className={styles.bossPage__BossPic}>
          <Image
            src="/sote.webp"
            alt="Sotetseg"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={styles.bossPage__KeyDetails}>
          <h2>Sotetseg</h2>
        </div>
      </div>

      <BossPageControls
        currentlyPlaying={playing}
        totalTicks={totalTicks}
        currentTick={currentTick}
        updateTick={updateTickOnPage}
        updatePlayingState={setPlaying}
        bossImage={SOTETSEG.imageSrc}
        bossName={SOTETSEG.bossName}
      />

      <BossPageAttackTimeline
        currentTick={currentTick}
        playing={playing}
        playerAttackTimelines={playerAttackTimelines}
        bossAttackTimeline={bossAttackTimeline}
        timelineTicks={totalTicks}
        updateTickOnPage={updateTickOnPage}
        inventoryTags={memes.inventoryTags}
        splits={splits}
      />

      <BossPageReplay
        entities={entities}
        mapDef={SOTETSEG_MAP_DEFINITION}
        playerDetails={playerDetails}
      />
    </>
  );
}
