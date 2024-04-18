'use client';

import {
  ChallengeType,
  EventType,
  HANDICAP_LEVEL_VALUE_INCREMENT,
  Npc,
  NpcEvent,
  PlayerUpdateEvent,
  SkillLevel,
  Stage,
} from '@blert/common';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useContext, useEffect } from 'react';

import BossPageAttackTimeline from '../../../../../components/boss-page-attack-timeline';
import { BossPageControls } from '../../../../../components/boss-page-controls/boss-page-controls';
import BossPageReplay from '../../../../../components/boss-page-replay';
import ColosseumHandicap from '../../../../../components/colosseum-handicap';
import { Entity, NpcEntity, PlayerEntity } from '../../../../../components/map';
import Loading from '../../../../../components/loading';
import { ActorContext, ColosseumContext } from '../../../context';
import {
  usePlayingState,
  useRoomEvents,
} from '../../../../../utils/boss-room-state';
import { ticksToFormattedSeconds } from '../../../../../utils/tick';
import { challengeUrl } from '../../../../../utils/url';

import styles from './style.module.scss';
import colosseumBaseTiles from './colosseum-tiles.json';

const COLOSSEUM_MAP_DEFINITION = {
  baseX: 1808,
  baseY: 3090,
  width: 34,
  height: 34,
  baseTiles: colosseumBaseTiles,
};

function imageForWave(waveNumber: number) {
  switch (waveNumber) {
    case 1:
      return '/images/colosseum/serpent-shaman.webp';
    case 2:
    case 3:
      return '/images/colosseum/javelin-colossus.webp';
    case 4:
    case 5:
    case 9:
    case 10:
    case 11:
      return '/images/colosseum/manticore.webp';
    case 6:
      return '/images/colosseum/jaguar-warrior.webp';
    case 7:
    case 8:
      return '/images/colosseum/shockwave-colossus.webp';
    case 12:
    default:
      return '/images/colosseum/sol-heredit.webp';
  }
}

type ColosseumWavePageProps = {
  params: { id: string; number: string };
};

function validWaveNumber(waveNumber: number) {
  return !isNaN(waveNumber) && waveNumber >= 1 && waveNumber <= 12;
}

function npcOutlineColor(npcId: number): string | undefined {
  if (Npc.isFremennikSeer(npcId) || Npc.isSerpentShaman(npcId)) {
    return '#42c6d7';
  }
  if (Npc.isFremennikArcher(npcId)) {
    return '#408d43';
  }
  if (Npc.isFremennikBerserker(npcId)) {
    return '#8b0e10';
  }
  if (Npc.isJavelinColossus(npcId)) {
    return '#24d72b';
  }
  if (Npc.isManticore(npcId)) {
    return '#9c27b0';
  }
  if (Npc.isShockwaveColossus(npcId)) {
    return '#3f5fff';
  }
  if (Npc.isSolarflare(npcId)) {
    return '#ff5e00';
  }

  return '#2d270c';
}

export default function ColosseumWavePage({
  params: { id: challengeId, number },
}: ColosseumWavePageProps) {
  const router = useRouter();

  const waveNumber = Number.parseInt(number, 10);
  useEffect(() => {
    if (!validWaveNumber(waveNumber)) {
      router.replace(challengeUrl(ChallengeType.COLOSSEUM, challengeId));
    }
  }, [challengeId, waveNumber, router]);

  const waveIndex = validWaveNumber(waveNumber) ? waveNumber - 1 : 0;
  const {
    challenge,
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    totalTicks,
  } = useRoomEvents(ColosseumContext, Stage.COLOSSEUM_WAVE_1 + waveIndex);

  const { selectedPlayer } = useContext(ActorContext);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  if (challenge === null) {
    return <Loading />;
  }

  const waveInfo = challenge.colosseum.waves[waveNumber - 1];
  if (waveInfo === undefined) {
    // TODO(frolv): Proper missing wave page.
    return <div>No data for wave {waveNumber}.</div>;
  }

  const title = waveNumber === 12 ? 'Sol Heredit' : `Wave ${waveNumber}`;

  // Collect all the handicaps that have been selected up to this wave.
  const handicapsSoFar = [];
  for (let i = 0; i < waveNumber; i++) {
    const handicap = challenge.colosseum.waves[i].handicap;
    const index: number = handicapsSoFar.findIndex(
      (h) => h === handicap || h == handicap - HANDICAP_LEVEL_VALUE_INCREMENT,
    );
    if (index === -1) {
      handicapsSoFar.push(handicap);
    } else {
      handicapsSoFar[index] = handicap;
    }
  }

  const eventsForCurrentTick = eventsByTick[currentTick] ?? [];

  const entities: Entity[] = [];

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
            npcOutlineColor(e.npc.id),
            Npc.isFremennik(e.npc.id) || Npc.isSerpentShaman(e.npc.id),
          ),
        );
        break;
      }
    }
  }

  const username = challenge.party[0];
  const playerTickState = {
    [username]: playerState.get(username)?.at(currentTick) ?? null,
  };

  let timelineSplits = [];
  if (waveNumber < 12) {
    const reinforcementTick =
      eventsByType[EventType.NPC_SPAWN]?.find((e) => (e as NpcEvent).tick > 1)
        ?.tick ?? 0;
    if (reinforcementTick > 1) {
      timelineSplits.push({
        tick: reinforcementTick,
        splitName: 'Reinforcements',
      });
    }
  }

  return (
    <div className={styles.wavePage}>
      <div className={styles.waveOverview}>
        <div className={styles.waveImage}>
          <Image
            src={imageForWave(waveNumber)}
            alt={`Fortis Colosseum Wave ${waveNumber}`}
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={styles.waveDetails}>
          <h2>
            {title} ({ticksToFormattedSeconds(waveInfo.ticks)})
          </h2>
          <div className={styles.handicaps}>
            <h3>Handicaps This Wave</h3>
            <ul>
              {waveInfo.options.map((option) => (
                <li key={option}>
                  <ColosseumHandicap
                    handicap={option}
                    dimmed={option !== waveInfo.handicap}
                  />
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.handicaps}>
            <h3>All Active Handicaps</h3>
            <ul>
              {handicapsSoFar.map((handicap) => (
                <li key={handicap}>
                  <ColosseumHandicap handicap={handicap} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <BossPageAttackTimeline
        currentTick={currentTick}
        playing={playing}
        playerState={playerState}
        timelineTicks={totalTicks}
        updateTickOnPage={updateTickOnPage}
        splits={timelineSplits}
        npcs={npcState}
        cellSize={40}
      />

      <BossPageReplay
        entities={entities}
        mapDef={COLOSSEUM_MAP_DEFINITION}
        playerTickState={playerTickState}
        tileSize={25}
      />

      <BossPageControls
        currentlyPlaying={playing}
        totalTicks={totalTicks}
        currentTick={currentTick}
        updateTick={updateTickOnPage}
        updatePlayingState={setPlaying}
        splits={timelineSplits}
      />
    </div>
  );
}
