'use client';

import {
  ChallengeStatus,
  EventType,
  PlayerUpdateEvent,
  NpcEvent,
  Npc,
  NyloWaveSpawnEvent,
  RoomNpcType,
  NpcId,
  Stage,
  SkillLevel,
} from '@blert/common';
import Image from 'next/image';
import { useMemo } from 'react';
import {
  EventTickMap,
  usePlayingState,
  useRoomEvents,
} from '../../../boss-room-state';
import { BossPageControls } from '../../../../../components/boss-page-controls/boss-page-controls';
import {
  BossPageAttackTimeline,
  TimelineColor,
  TimelineSplit,
} from '../../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import BossPageReplay from '../../../../../components/boss-page-replay';
import { Entity, NpcEntity, PlayerEntity } from '../../../../../components/map';
import { OverlayEntity } from '../../../../../components/map/overlay';
import Loading from '../../../../../components/loading';

import styles from './style.module.scss';
import nyloBaseTiles from './nylo-tiles.json';
import { ticksToFormattedSeconds } from '../../../../../utils/tick';

const NYLOCAS_MAP_DEFINITION = {
  baseX: 3279,
  baseY: 4232,
  width: 34,
  height: 25,
  faceSouth: true,
  baseTiles: nyloBaseTiles,
};

const LAST_NYLO_WAVE = 31;

const GRAY_NYLO_COLOR = '#a9aaab';
const GREEN_NYLO_COLOR = '#408d43';
const BLUE_NYLO_COLOR = '#42c6d7';

const NORTH_BARRIER = new OverlayEntity(
  3299,
  4255,
  'barrier',
  (
    <div className={styles.barrierNorth}>
      <div className={styles.entrance}></div>
    </div>
  ),
  /*interactable=*/ false,
);

const WEST_BARRIER = new OverlayEntity(
  3289,
  4245,
  'barrier',
  (
    <div className={styles.barrierWest}>
      <div className={styles.entrance}></div>
    </div>
  ),
  /*interactable=*/ false,
);

const SOUTH_BARRIER = new OverlayEntity(
  3299,
  4242,
  'barrier',
  (
    <div className={styles.barrierSouth}>
      <div className={styles.entrance}></div>
    </div>
  ),
  /*interactable=*/ false,
);

const EAST_BARRIER = new OverlayEntity(
  3302,
  4245,
  'barrier',
  (
    <div className={styles.barrierEast}>
      <div className={styles.entrance}></div>
    </div>
  ),
  /*interactable=*/ false,
);

/**
 * Returns the style-based color for a Nylocas NPC.
 *
 * @param npcId ID of the Nylo.
 * @param background If true, the color will be dimmed.
 * @returns Hex color code for the Nylo.
 */
function getNyloColor(npcId: number, background?: boolean): string | undefined {
  let color = undefined;
  if (Npc.isNylocasIschyros(npcId)) {
    color = GRAY_NYLO_COLOR;
  } else if (Npc.isNylocasToxobolos(npcId)) {
    color = GREEN_NYLO_COLOR;
  } else if (Npc.isNylocasHagios(npcId)) {
    color = BLUE_NYLO_COLOR;
  } else {
    switch (npcId) {
      case NpcId.NYLOCAS_PRINKIPAS_DROPPING:
      case NpcId.NYLOCAS_PRINKIPAS_MELEE:
      case NpcId.NYLOCAS_VASILIAS_DROPPING_ENTRY:
      case NpcId.NYLOCAS_VASILIAS_DROPPING_REGULAR:
      case NpcId.NYLOCAS_VASILIAS_DROPPING_HARD:
      case NpcId.NYLOCAS_VASILIAS_MELEE_ENTRY:
      case NpcId.NYLOCAS_VASILIAS_MELEE_REGULAR:
      case NpcId.NYLOCAS_VASILIAS_MELEE_HARD:
        color = GRAY_NYLO_COLOR;
        break;

      case NpcId.NYLOCAS_PRINKIPAS_RANGE:
      case NpcId.NYLOCAS_VASILIAS_RANGE_ENTRY:
      case NpcId.NYLOCAS_VASILIAS_RANGE_REGULAR:
      case NpcId.NYLOCAS_VASILIAS_RANGE_HARD:
        color = GREEN_NYLO_COLOR;
        break;

      case NpcId.NYLOCAS_PRINKIPAS_MAGE:
      case NpcId.NYLOCAS_VASILIAS_MAGE_ENTRY:
      case NpcId.NYLOCAS_VASILIAS_MAGE_REGULAR:
      case NpcId.NYLOCAS_VASILIAS_MAGE_HARD:
        color = BLUE_NYLO_COLOR;
        break;
    }
  }

  if (color !== undefined && background) {
    // Apply an alpha value to the color to dim it.
    color = `${color}40`;
  }

  return color;
}

/**
 * Returns an array of timeline background color ranges for the ticks at which
 * a Nylo boss is alive.
 *
 * @param eventsByTick All room events, indexed by tick.
 * @param totalTicks Total number of ticks in the room.
 * @returns List of background colors to apply.
 */
function nyloBossBackgroundColors(
  eventsByTick: EventTickMap,
  totalTicks: number,
): TimelineColor[] {
  if (totalTicks === 0) {
    return [];
  }

  let colors: TimelineColor[] = [];

  let startTick: number | undefined = undefined;
  let bossId: number | undefined = undefined;

  for (let tick = 0; tick <= totalTicks; tick++) {
    const bossEvent = eventsByTick[tick]?.find((evt) => {
      if (
        evt.type === EventType.NPC_SPAWN ||
        evt.type === EventType.NPC_UPDATE
      ) {
        const e = evt as NpcEvent;
        return (
          Npc.isNylocasPrinkipas(e.npc.id) || Npc.isNylocasVasilias(e.npc.id)
        );
      }
      return false;
    });

    const nyloBoss = (bossEvent as NpcEvent)?.npc;
    if (
      nyloBoss === undefined ||
      SkillLevel.fromRaw(nyloBoss.hitpoints).getCurrent() === 0
    ) {
      if (startTick !== undefined) {
        const backgroundColor = getNyloColor(bossId!, true);
        if (backgroundColor !== undefined) {
          colors.push({
            tick: startTick,
            length: tick - startTick + 1,
            backgroundColor,
          });
        }
      }

      startTick = undefined;
      bossId = undefined;
      continue;
    }

    if (nyloBoss.id !== bossId) {
      if (startTick !== undefined) {
        const backgroundColor = getNyloColor(bossId!, true);
        if (backgroundColor !== undefined) {
          colors.push({
            tick: startTick,
            length: tick - startTick,
            backgroundColor,
          });
        }
      }

      startTick = tick;
      bossId = nyloBoss.id;
    }
  }

  return colors;
}

export default function NylocasPage() {
  const {
    raidData,
    totalTicks,
    events,
    eventsByTick,
    eventsByType,
    bossAttackTimeline,
    playerState,
    loading,
  } = useRoomEvents(Stage.TOB_NYLOCAS);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const backgroundColors = useMemo(
    () => nyloBossBackgroundColors(eventsByTick, totalTicks),
    [eventsByTick],
  );

  const splits = useMemo(() => {
    if (raidData === null || events.length === 0) {
      return [];
    }
    let splits: TimelineSplit[] =
      eventsByType[EventType.TOB_NYLO_WAVE_SPAWN]?.map((evt) => {
        const wave = (evt as NyloWaveSpawnEvent).nyloWave.wave;
        const importantWaves: { [wave: number]: string } = {
          20: 'Cap',
          31: 'Waves',
        };

        return {
          tick: evt.tick,
          splitName: importantWaves[wave] ?? wave.toString(),
          unimportant: importantWaves[wave] === undefined,
        };
      }) ?? [];

    const nyloData = raidData.tobRooms.nylocas;
    if (nyloData !== null) {
      if (nyloData.splits.cleanup) {
        splits.push({
          tick: nyloData.splits.cleanup,
          splitName: 'Cleanup',
        });
      }
      if (nyloData.splits.boss) {
        splits.push({
          tick: nyloData.splits.boss,
          splitName: 'Boss',
        });
      }
    }
    return splits;
  }, [events, raidData]);

  if (loading || raidData === null) {
    return <Loading />;
  }

  const nyloData = raidData.tobRooms.nylocas;
  if (raidData.status !== ChallengeStatus.IN_PROGRESS && nyloData === null) {
    return <>No Nylocas data for this raid</>;
  }

  const eventsForCurrentTick = eventsByTick[currentTick] ?? [];

  const entities: Entity[] = [
    NORTH_BARRIER,
    WEST_BARRIER,
    SOUTH_BARRIER,
    EAST_BARRIER,
  ];
  const players: PlayerEntity[] = [];

  let nylosAlive = 0;

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
        if (e.npc.type === RoomNpcType.NYLO) {
          nylosAlive++;
        }
        entities.push(
          new NpcEntity(
            e.xCoord,
            e.yCoord,
            e.npc.id,
            e.npc.roomId,
            SkillLevel.fromRaw(e.npc.hitpoints),
            getNyloColor(e.npc.id),
          ),
        );
        break;
      }
    }
  }

  const currentWave = (
    eventsByType[EventType.TOB_NYLO_WAVE_SPAWN] as NyloWaveSpawnEvent[]
  )?.findLast((evt) => evt.tick <= currentTick)?.nyloWave;

  const cleanupEvent = eventsByType[EventType.TOB_NYLO_CLEANUP_END]?.at(0);
  const cleanupEnded =
    cleanupEvent !== undefined && cleanupEvent.tick <= currentTick;

  if (currentWave !== undefined && currentWave.wave > 0 && !cleanupEnded) {
    const wave = currentWave.wave;
    const waveTitle = wave < LAST_NYLO_WAVE ? `Wave ${wave}` : 'Cleanup';

    const capColor =
      nylosAlive >= currentWave.roomCap ? 'var(--blert-red)' : 'green';

    const overlay = (
      <div className={styles.waveIndicator}>
        <div>{waveTitle}</div>
        <div className={styles.cap} style={{ color: capColor }}>
          {nylosAlive}/{currentWave.roomCap}
        </div>
      </div>
    );

    entities.push(
      new OverlayEntity(
        NYLOCAS_MAP_DEFINITION.baseX + 2,
        NYLOCAS_MAP_DEFINITION.baseY,
        `nylo-wave-${currentWave}-indicator`,
        overlay,
      ),
    );
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
            src="/nyloking.webp"
            alt="Nylocas Vasilias"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={styles.bossPage__KeyDetails}>
          <h2>The Nylocas ({ticksToFormattedSeconds(totalTicks)})</h2>
        </div>
      </div>

      <BossPageAttackTimeline
        currentTick={currentTick}
        playing={playing}
        playerState={playerState}
        bossAttackTimeline={bossAttackTimeline}
        timelineTicks={totalTicks}
        updateTickOnPage={updateTickOnPage}
        splits={splits}
        backgroundColors={backgroundColors}
        npcs={nyloData?.npcs ?? {}}
      />

      <BossPageReplay
        entities={entities}
        mapDef={NYLOCAS_MAP_DEFINITION}
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
