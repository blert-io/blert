'use client';

import {
  ChallengeStatus,
  EventType,
  NpcEvent,
  PlayerUpdateEvent,
  SkillLevel,
  Stage,
} from '@blert/common';
import Image from 'next/image';
import { useMemo } from 'react';

import {
  usePlayingState,
  useRoomEvents,
} from '../../../../../utils/boss-room-state';
import { RaidContext } from '../../../context';
import { BossPageControls } from '../../../../../components/boss-page-controls/boss-page-controls';
import { BossPageAttackTimeline } from '../../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import BossPageReplay from '../../../../../components/boss-page-replay';
import {
  Entity,
  NpcEntity,
  OverlayEntity,
  PlayerEntity,
} from '../../../../../components/map';
import Loading from '../../../../../components/loading';
import { ticksToFormattedSeconds } from '../../../../../utils/tick';

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
    challenge: raidData,
    totalTicks,
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    loading,
  } = useRoomEvents(RaidContext, Stage.TOB_SOTETSEG);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const splits = useMemo(() => {
    const sote = raidData?.tobRooms.sotetseg;
    const splits = [];
    if (sote) {
      if (sote.splits.MAZE_66) {
        splits.push({
          tick: sote.splits.MAZE_66,
          splitName: '66%',
        });
      }
      if (sote.splits.MAZE_33) {
        splits.push({
          tick: sote.splits.MAZE_33,
          splitName: '33%',
        });
      }
    }
    return splits;
  }, [raidData?.tobRooms.sotetseg]);

  if (loading || raidData === null) {
    return <Loading />;
  }

  const soteData = raidData.tobRooms.sotetseg;
  if (raidData.status !== ChallengeStatus.IN_PROGRESS && soteData === null) {
    return <>No Sotetseg data for this raid</>;
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

  const playerTickState = raidData.party.reduce(
    (acc, username) => ({
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
            src="/sote.webp"
            alt="Sotetseg"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={styles.bossPage__KeyDetails}>
          <h2>Sotetseg ({ticksToFormattedSeconds(totalTicks)})</h2>
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
        mapDef={SOTETSEG_MAP_DEFINITION}
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
