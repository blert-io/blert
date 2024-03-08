'use client';

import {
  EventType,
  PlayerUpdateEvent,
  NpcEvent,
  Npc,
  Room,
  NyloWaveSpawnEvent,
  RoomNpcType,
  NpcId,
} from '@blert/common';
import Image from 'next/image';
import { useContext } from 'react';
import { NYLOCAS } from '../../../../../bosses/tob';
import { usePlayingState, useRoomEvents } from '../../../boss-room-state';
import { BossPageControls } from '../../../../../components/boss-page-controls/boss-page-controls';
import { BossPageAttackTimeline } from '../../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import BossPageReplay from '../../../../../components/boss-page-replay';
import {
  Entity,
  MarkerEntity,
  NpcEntity,
  PlayerEntity,
} from '../../../../../components/map';
import { OverlayEntity } from '../../../../../components/map/overlay';
import { MemeContext } from '../../../../meme-context';

import styles from './style.module.scss';
import nyloBaseTiles from './nylo-tiles.json';

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

function getNyloColor(npcId: number): string | undefined {
  if (Npc.isNylocasIschyros(npcId)) {
    return GRAY_NYLO_COLOR;
  }
  if (Npc.isNylocasToxobolos(npcId)) {
    return GREEN_NYLO_COLOR;
  }
  if (Npc.isNylocasHagios(npcId)) {
    return BLUE_NYLO_COLOR;
  }

  switch (npcId) {
    case NpcId.NYLOCAS_PRINKIPAS_DROPPING:
    case NpcId.NYLOCAS_PRINKIPAS_MELEE:
    case NpcId.NYLOCAS_VASILIAS_DROPPING_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_DROPPING_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_DROPPING_HARD:
    case NpcId.NYLOCAS_VASILIAS_MELEE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_MELEE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_MELEE_HARD:
      return GRAY_NYLO_COLOR;

    case NpcId.NYLOCAS_PRINKIPAS_RANGE:
    case NpcId.NYLOCAS_VASILIAS_RANGE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_RANGE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_RANGE_HARD:
      return GREEN_NYLO_COLOR;

    case NpcId.NYLOCAS_PRINKIPAS_MAGE:
    case NpcId.NYLOCAS_VASILIAS_MAGE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_MAGE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_MAGE_HARD:
      return BLUE_NYLO_COLOR;
  }

  return undefined;
}

export default function NylocasPage() {
  const {
    raidData,
    events,
    totalTicks,
    eventsByTick,
    eventsByType,
    bossAttackTimeline,
    playerAttackTimelines,
  } = useRoomEvents(Room.NYLOCAS);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const memes = useContext(MemeContext);

  if (raidData === null || events.length === 0) {
    return <>Loading...</>;
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
        if (e.npc.type === RoomNpcType.NYLO) {
          nylosAlive++;
        }
        entities.push(
          new NpcEntity(
            e.xCoord,
            e.yCoord,
            e.npc.id,
            e.npc.roomId,
            e.npc.hitpoints,
            getNyloColor(e.npc.id),
          ),
        );
        break;
      }
    }
  }

  const currentWave = (
    eventsByType[EventType.NYLO_WAVE_SPAWN] as NyloWaveSpawnEvent[]
  )?.findLast((evt) => evt.tick <= currentTick)?.nyloWave;

  const cleanupEvent = eventsByType[EventType.NYLO_CLEANUP_END]?.at(0);
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
          <h2>The Nylocas</h2>
        </div>
      </div>

      <BossPageControls
        currentlyPlaying={playing}
        totalTicks={totalTicks}
        currentTick={currentTick}
        updateTick={updateTickOnPage}
        updatePlayingState={setPlaying}
        bossImage={NYLOCAS.imageSrc}
        bossName={NYLOCAS.bossName}
      />

      <BossPageAttackTimeline
        currentTick={currentTick}
        playing={playing}
        playerAttackTimelines={playerAttackTimelines}
        bossAttackTimeline={bossAttackTimeline}
        timelineTicks={totalTicks}
        updateTickOnPage={updateTickOnPage}
        inventoryTags={memes.inventoryTags}
      />

      <BossPageReplay entities={entities} mapDef={NYLOCAS_MAP_DEFINITION} />
    </>
  );
}
