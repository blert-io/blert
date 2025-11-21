'use client';

import {
  ChallengeType,
  EventType,
  InfernoChallenge,
  NpcId,
  NpcSpawnEvent,
  Stage,
} from '@blert/common';
import { notFound, useRouter } from 'next/navigation';
import { use, useCallback, useContext, useEffect, useMemo } from 'react';

import BossFightOverview, {
  BossFightOverviewSection,
} from '@/components/boss-fight-overview';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import BossPageControls from '@/components/boss-page-controls';
import BossPageParty from '@/components/boss-page-party';
import { NewBossPageReplay } from '@/components/boss-page-replay';
import Loading from '@/components/loading';
import {
  AnyEntity,
  EntityType,
  MapDefinition,
  NpcEntity,
} from '@/components/map-renderer';
import { useDisplay } from '@/display';
import {
  useMapEntities,
  usePlayingState,
  useStageEvents,
} from '@/utils/boss-room-state';
import { challengeUrl } from '@/utils/url';

import { ActorContext } from '../../../context';

import styles from './style.module.scss';
import { ticksToFormattedSeconds } from '@/utils/tick';

function validWaveNumber(waveNumber: number) {
  return !isNaN(waveNumber) && waveNumber >= 1 && waveNumber <= 69;
}

const INFERNO_MAP_DEFINITION: MapDefinition = {
  baseX: 2240,
  baseY: 5312,
  width: 64,
  height: 64,
};

type InfernoWavePageProps = {
  params: Promise<{ id: string; number: string }>;
};

export default function InfernoWavePage({ params }: InfernoWavePageProps) {
  const router = useRouter();
  const display = useDisplay();
  const { id, number } = use(params);

  const compact = display.isCompact();

  const waveNumber = Number.parseInt(number, 10);
  useEffect(() => {
    if (!validWaveNumber(waveNumber)) {
      router.replace(challengeUrl(ChallengeType.INFERNO, id));
    }
  }, [id, waveNumber, router]);

  const mapDef = useMemo(() => {
    const initialZoom = compact ? 13 : 25;
    const initialCameraPosition = {
      x: 2271.5,
      y: waveNumber === 69 ? 5358 : 5344,
    };
    return {
      ...INFERNO_MAP_DEFINITION,
      initialZoom,
      initialCameraPosition,
    };
  }, [waveNumber, compact]);

  const waveIndex = validWaveNumber(waveNumber) ? waveNumber - 1 : 0;
  const stage = Stage.INFERNO_WAVE_1 + waveIndex;
  const {
    challenge,
    eventsByType,
    playerState,
    npcState,
    totalTicks,
    loading,
  } = useStageEvents<InfernoChallenge>(stage);

  const { currentTick, setTick, playing, setPlaying, advanceTick } =
    usePlayingState(totalTicks);

  const { selectedPlayer, setSelectedPlayer } = useContext(ActorContext);

  const modifyEntity = useCallback((_: number, entity: AnyEntity) => {
    if (entity.type !== EntityType.NPC) {
      return entity;
    }

    const npc = entity as NpcEntity;
    if (npc.id !== (NpcId.ROCKY_SUPPORT as number)) {
      return entity;
    }

    const hpPercent = npc.hitpoints?.current.percentage();
    if (hpPercent === undefined) {
      return entity;
    }

    if (hpPercent <= 25) {
      npc.imageUrl = '/images/inferno/pillar-25.png';
    } else if (hpPercent <= 50) {
      npc.imageUrl = '/images/inferno/pillar-50.png';
    } else if (hpPercent <= 75) {
      npc.imageUrl = '/images/inferno/pillar-75.png';
    } else {
      npc.imageUrl = '/images/inferno/pillar-100.png';
    }

    return npc;
  }, []);

  const { entitiesByTick, preloads } = useMapEntities(
    challenge,
    playerState,
    npcState,
    totalTicks,
    { modifyEntity },
  );

  if (challenge === null || loading) {
    return <Loading />;
  }

  const waveInfo = challenge.inferno.waves.find((wave) => wave.stage === stage);
  if (waveInfo === undefined) {
    notFound();
  }

  const username = challenge.party[0].username;
  const playerTickState = {
    [username]: playerState.get(username)?.at(currentTick) ?? null,
  };

  const title = `Wave ${waveNumber}`;

  const sections: BossFightOverviewSection[] = [];
  if (stage === Stage.INFERNO_WAVE_69) {
    let setNumber = 0;
    const splits = new Map<number, string>();

    eventsByType[EventType.NPC_SPAWN]
      ?.filter((evt) => {
        const npcId = (evt as NpcSpawnEvent).npc.id;
        return (
          npcId === (NpcId.JAL_ZEK_ZUK as number) ||
          npcId === (NpcId.JALTOK_JAD_ZUK as number) ||
          npcId === (NpcId.JAL_MEJJAK as number)
        );
      })
      .forEach((evt) => {
        switch ((evt as NpcSpawnEvent).npc.id) {
          case NpcId.JAL_ZEK_ZUK as number:
            setNumber++;
            splits.set(evt.tick, `Set ${setNumber}`);
            return;
          case NpcId.JALTOK_JAD_ZUK as number:
            splits.set(evt.tick, 'Jad');
            return;
          case NpcId.JAL_MEJJAK as number:
            splits.set(evt.tick, 'Healers');
            return;
        }
      });
    const zukSplits = Array.from(splits.entries()).sort((a, b) => a[0] - b[0]);

    sections.push({
      title: 'Zuk Splits',
      content: (
        <div className={styles.zukSplits}>
          {zukSplits.map(([tick, label]) => (
            <div key={tick} className={styles.splitItem}>
              <div className={styles.splitInfo}>
                <span className={styles.splitLabel}>{label}</span>
                <span className={styles.splitTick}>Tick {tick}</span>
              </div>
              <button
                className={styles.splitTime}
                onClick={() => setTick(tick)}
              >
                <i className="fas fa-play" />
                {ticksToFormattedSeconds(tick)}
              </button>
            </div>
          ))}
        </div>
      ),
    });
  }

  return (
    <div className={styles.wavePage}>
      <div className={styles.overview}>
        <BossFightOverview
          name={title}
          image="/images/inferno.png"
          time={totalTicks}
          sections={sections}
        />
      </div>

      <div className={styles.timeline}>
        <BossPageAttackTimeline
          currentTick={currentTick}
          playing={playing}
          playerState={playerState}
          timelineTicks={totalTicks}
          updateTickOnPage={setTick}
          npcs={npcState}
          smallLegend={display.isCompact()}
        />
      </div>

      <div className={styles.replayAndParty}>
        <NewBossPageReplay
          entities={entitiesByTick.get(currentTick) ?? []}
          preloads={preloads}
          mapDef={mapDef}
          playing={playing}
          width={compact ? 340 : 800}
          height={compact ? 340 : 800}
          currentTick={currentTick}
          advanceTick={advanceTick}
        />
        <BossPageParty
          playerTickState={playerTickState}
          selectedPlayer={selectedPlayer}
          setSelectedPlayer={setSelectedPlayer}
        />
      </div>

      <BossPageControls
        currentlyPlaying={playing}
        totalTicks={totalTicks}
        currentTick={currentTick}
        updateTick={setTick}
        updatePlayingState={setPlaying}
      />
    </div>
  );
}
