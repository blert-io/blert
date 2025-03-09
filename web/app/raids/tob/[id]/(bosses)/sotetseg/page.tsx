'use client';

import {
  ChallengeStatus,
  EventType,
  Npc,
  NpcEvent,
  PlayerUpdateEvent,
  SkillLevel,
  SoteMazePathEvent,
  SplitType,
  Stage,
  TobRaid,
} from '@blert/common';
import { useContext, useMemo } from 'react';

import BossFightOverview from '@/components/boss-fight-overview';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import BossPageControls from '@/components/boss-page-controls';
import BossPageDPSTimeline from '@/components/boss-page-dps-timeline';
import BossPageParty from '@/components/boss-page-party';
import BossPageReplay from '@/components/boss-page-replay';
import Card from '@/components/card';
import Loading from '@/components/loading';
import {
  Entity,
  NpcEntity,
  OverlayEntity,
  PlayerEntity,
} from '@/components/map';
import { useDisplay } from '@/display';
import { ActorContext } from '@/raids/tob/context';
import {
  EnhancedRoomNpc,
  usePlayingState,
  useStageEvents,
} from '@/utils/boss-room-state';
import { ticksToFormattedSeconds } from '@/utils/tick';

import soteBaseTiles from './sote-tiles.json';
import bossStyles from '../style.module.scss';
import styles from './style.module.scss';

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
        No maze data
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
  const display = useDisplay();

  const {
    challenge: raidData,
    totalTicks,
    eventsByTick,
    playerState,
    npcState,
    loading,
  } = useStageEvents<TobRaid>(Stage.TOB_SOTETSEG);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const { selectedPlayer, setSelectedPlayer } = useContext(ActorContext);

  const splits = useMemo(() => {
    if (!raidData) {
      return [];
    }

    const splits = [];
    if (raidData.splits[SplitType.TOB_SOTETSEG_66]) {
      splits.push({
        tick: raidData.splits[SplitType.TOB_SOTETSEG_66],
        splitName: '66%',
      });
    }
    if (raidData.splits[SplitType.TOB_SOTETSEG_33]) {
      splits.push({
        tick: raidData.splits[SplitType.TOB_SOTETSEG_33],
        splitName: '33%',
      });
    }
    return splits;
  }, [raidData]);

  const bossHealthChartData = useMemo(() => {
    let sotetseg: EnhancedRoomNpc | null = null;
    let iter = npcState.values();
    for (let npc = iter.next(); !npc.done; npc = iter.next()) {
      if (Npc.isSotetseg(npc.value.spawnNpcId)) {
        sotetseg = npcState.get(npc.value.roomId)!;
        break;
      }
    }

    return (
      sotetseg?.stateByTick.map((state, tick) => ({
        tick,
        bossHealthPercentage: state?.hitpoints.percentage() ?? 0,
      })) ?? []
    );
  }, [npcState]);

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
    (acc, { username }) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  const mazeSections = [];

  if (soteData?.maze1Pivots) {
    mazeSections.push({
      title: 'Maze 1',
      content: (
        <div className={styles.mazeInfo}>
          <Maze pivots={soteData.maze1Pivots} tileSize={10} />
          <div className={styles.details}>
            <div className={styles.mazeStat}>
              <i className="fa-solid fa-hourglass" />
              {ticksToFormattedSeconds(
                raidData.splits[SplitType.TOB_SOTETSEG_66] ?? 0,
              )}
            </div>
            <div className={styles.mazeStat}>
              <i className="fa-solid fa-person-walking" />
              {ticksToFormattedSeconds(
                raidData.splits[SplitType.TOB_SOTETSEG_MAZE_1] ?? 0,
              )}
            </div>
          </div>
        </div>
      ),
    });
  }

  if (soteData?.maze2Pivots) {
    mazeSections.push({
      title: 'Maze 2',
      content: (
        <div className={styles.mazeInfo}>
          <Maze pivots={soteData.maze2Pivots} tileSize={10} />
          <div className={styles.details}>
            <div className={styles.mazeStat}>
              <i className="fa-solid fa-hourglass" />
              {ticksToFormattedSeconds(
                raidData.splits[SplitType.TOB_SOTETSEG_33] ?? 0,
              )}
            </div>
            <div className={styles.mazeStat}>
              <i className="fa-solid fa-person-walking" />
              {ticksToFormattedSeconds(
                raidData.splits[SplitType.TOB_SOTETSEG_MAZE_2] ?? 0,
              )}
            </div>
          </div>
        </div>
      ),
    });
  }

  return (
    <>
      <div className={bossStyles.overview}>
        <BossFightOverview
          name="Sotetseg"
          image="/sote.webp"
          time={totalTicks}
          sections={mazeSections}
        />
      </div>

      <div className={bossStyles.timeline}>
        <BossPageAttackTimeline
          currentTick={currentTick}
          playing={playing}
          playerState={playerState}
          timelineTicks={totalTicks}
          updateTickOnPage={updateTickOnPage}
          splits={splits}
          npcs={npcState}
          smallLegend={display.isCompact()}
        />
      </div>

      <div className={bossStyles.replayAndParty}>
        <BossPageReplay
          entities={entities}
          mapDef={SOTETSEG_MAP_DEFINITION}
          tileSize={display.isCompact() ? 20 : undefined}
        />
        <BossPageParty
          playerTickState={playerTickState}
          selectedPlayer={selectedPlayer}
          setSelectedPlayer={setSelectedPlayer}
        />
      </div>

      <div className={bossStyles.charts}>
        <Card
          className={bossStyles.chart}
          header={{ title: "Sotetseg's Health By Tick" }}
        >
          <BossPageDPSTimeline
            currentTick={currentTick}
            data={bossHealthChartData}
            width="100%"
            height="100%"
          />
        </Card>
      </div>

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
