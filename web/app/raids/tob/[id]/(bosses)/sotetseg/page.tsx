'use client';

import {
  ChallengeStatus,
  EventType,
  NpcEvent,
  PlayerUpdateEvent,
  SkillLevel,
  SoteMazePathEvent,
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

type MazeProps = {
  pivots: number[];
  tileSize: number;
  showPivots?: boolean;
};

function Maze({ pivots, tileSize, showPivots = false }: MazeProps) {
  const tileSizeWithBorder = tileSize + 2;
  const additionalTiles = showPivots ? 1 : 0;
  if (pivots.length !== 8) {
    return (
      <div
        className={`${styles.maze} ${styles.empty}`}
        style={{
          width: tileSizeWithBorder * (MAZE_WIDTH + additionalTiles),
          height: tileSizeWithBorder * (MAZE_HEIGHT + additionalTiles),
        }}
      >
        Not enough data.
      </div>
    );
  }

  const mazeTiles: boolean[][] = [];

  for (let y = MAZE_HEIGHT - 1; y >= 0; --y) {
    const row = new Array(MAZE_WIDTH).fill(false);

    if (y % 2 === 0) {
      row[pivots[y / 2]] = true;
    } else {
      const prevPivot = pivots[(y + 1) / 2];
      const nextPivot = pivots[(y - 1) / 2];
      let startX, endX;
      if (prevPivot < nextPivot) {
        startX = prevPivot;
        endX = nextPivot;
      } else {
        startX = nextPivot;
        endX = prevPivot;
      }

      for (let x = startX; x <= endX; ++x) {
        row[x] = true;
      }
    }
    mazeTiles.push(row);
  }

  let xAxis = undefined;
  if (showPivots) {
    const legend = [
      <div
        key="empty"
        className={styles.coord}
        style={{ height: tileSize, width: tileSize }}
      />,
    ];
    for (let x = 0; x < MAZE_WIDTH; ++x) {
      legend.push(
        <div
          key={x}
          className={styles.coord}
          style={{ height: tileSize, width: tileSize }}
        >
          {x}
        </div>,
      );
    }

    xAxis = <div className={styles.mazeRow}>{legend}</div>;
  }

  return (
    <div className={styles.maze}>
      {mazeTiles.map((row, y) => (
        <div key={y} className={styles.mazeRow}>
          {showPivots && (
            <div
              className={styles.coord}
              style={{ height: tileSize, width: tileSize }}
            >
              {MAZE_HEIGHT - y - 1}
            </div>
          )}
          {row.map((tile, x) => (
            <div
              key={x}
              className={`${styles.mazeTile} ${tile ? styles.active : ''}`}
              style={{ height: tileSize, width: tileSize }}
            >
              {(showPivots && y % 2 === 0 && tile && (
                <span className={styles.pivot}>{x}</span>
              )) || <div className={styles.circle} />}
            </div>
          ))}
        </div>
      ))}
      {xAxis}
    </div>
  );
}

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
  const mazeTileOverlay = (active: boolean) => (
    <div className={`${styles.mapTile} ${active ? styles.active : ''}`}>
      <div className={styles.circle} />
    </div>
  );

  const activeTiles =
    (
      eventsForCurrentTick.find(
        (e) => e.type === EventType.TOB_SOTE_MAZE_PATH,
      ) as SoteMazePathEvent
    )?.soteMaze.activeTiles ?? [];

  for (let y = 0; y < MAZE_HEIGHT; ++y) {
    for (let x = 0; x < MAZE_WIDTH; ++x) {
      const absX = MAZE_START_X + x;
      const absY = MAZE_START_Y + y;

      const active = activeTiles.some((tile) => tile.x === x && tile.y === y);

      entities.push(
        new OverlayEntity(
          absX,
          absY,
          `maze-tile-${x}-${y}`,
          mazeTileOverlay(active),
          false,
        ),
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
          <div className={styles.mazes}>
            {soteData?.maze66 && (
              <div className={styles.mazeInfo}>
                <Maze pivots={soteData.maze66.pivots} tileSize={10} />
                <div className={styles.details}>
                  <h3>Maze 1</h3>
                  <div className={styles.mazeStat}>
                    <i className="fa-solid fa-hourglass" />
                    {ticksToFormattedSeconds(soteData.splits.MAZE_66)}
                  </div>
                  <div className={styles.mazeStat}>
                    <i className="fa-solid fa-person-walking" />
                    {ticksToFormattedSeconds(soteData.maze66.ticks)}
                  </div>
                </div>
              </div>
            )}
            {soteData?.maze33 && (
              <div className={styles.mazeInfo}>
                <Maze pivots={soteData.maze33.pivots} tileSize={10} />
                <div className={styles.details}>
                  <h3>Maze 2</h3>
                  <div className={styles.mazeStat}>
                    <i className="fa-solid fa-hourglass" />
                    {ticksToFormattedSeconds(soteData.splits.MAZE_33)}
                  </div>
                  <div className={styles.mazeStat}>
                    <i className="fa-solid fa-person-walking" />
                    {ticksToFormattedSeconds(soteData.maze33.ticks)}
                  </div>
                </div>
              </div>
            )}
          </div>
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
