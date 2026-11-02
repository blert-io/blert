'use client';

import {
  ChallengeType,
  InfernoChallenge,
  Npc,
  Stage,
  stageName,
} from '@blert/common';
import { notFound, useRouter } from 'next/navigation';
import { use, useCallback, useContext, useEffect, useMemo } from 'react';

import BossFightOverview, {
  BossFightOverviewSection,
  IdleTicksContent,
  SpawnContent,
} from '@/components/boss-fight-overview';
import BossPageAttackTimeline, {
  useBossPageTimeline,
} from '@/components/boss-page-attack-timeline';
import BossPageControls from '@/components/boss-page-controls';
import BossPageParty from '@/components/boss-page-party';
import BossPageReplay from '@/components/boss-page-replay';
import Loading from '@/components/loading';
import {
  AnyEntity,
  EntityType,
  MapDefinition,
  NpcEntity,
} from '@/components/map-renderer';
import { useDisplay } from '@/display';
import {
  computeIdleTickCounts,
  useMapEntities,
  usePreloads,
  usePlayingState,
  useStageEvents,
} from '@/utils/boss-room-state';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl } from '@/utils/url';

import { ActorContext } from '../../../context';

import styles from './style.module.scss';

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
    playerState,
    npcState,
    bcf,
    totalTicks,
    loading,
    isLive,
    isStreaming,
  } = useStageEvents<InfernoChallenge>(stage);

  const timeline = useBossPageTimeline(bcf);
  const splits = useMemo(() => timeline.display.getSplits(), [timeline]);

  const {
    currentTick,
    setTick,
    playing,
    setPlaying,
    advanceTick,
    following,
    jumpToLive,
  } = usePlayingState(0, totalTicks, isStreaming);

  const { selectedActor, setSelectedActor } = useContext(ActorContext);

  const modifyEntity = useCallback((_: number, entity: AnyEntity) => {
    if (entity.type !== EntityType.NPC) {
      return entity;
    }

    const npc = entity as NpcEntity;
    if (!Npc.isRockySupport(npc.id)) {
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

  const getEntities = useMapEntities(
    challenge,
    playerState,
    npcState,
    totalTicks,
    { modifyEntity },
  );
  const preloads = usePreloads(npcState, isLive);

  const sections = useMemo((): BossFightOverviewSection[] => {
    if (stage !== Stage.INFERNO_WAVE_69) {
      return [];
    }

    return [
      {
        span: 2,
        title: 'Splits',
        content: (
          <div className={styles.zukSplits}>
            {splits.map((split) => (
              <div key={split.tick} className={styles.splitItem}>
                <div className={styles.splitInfo}>
                  <span className={styles.splitLabel}>{split.splitName}</span>
                  <span className={styles.splitTick}>Tick {split.tick}</span>
                </div>
                <button
                  className={styles.splitTime}
                  onClick={() => setTick(split.tick)}
                >
                  <i className="fas fa-play" />
                  {ticksToFormattedSeconds(split.tick)}
                </button>
              </div>
            ))}
          </div>
        ),
      },
    ];
  }, [stage, splits, setTick]);

  const idleTickCounts = useMemo(
    () => computeIdleTickCounts(playerState),
    [playerState],
  );

  if (challenge === null || loading) {
    return <Loading />;
  }

  const waveInfo = challenge.inferno.waves.find((wave) => wave.stage === stage);
  if (!isLive && waveInfo === undefined) {
    notFound();
  }

  const username = challenge.party[0].username;

  const overviewSections = [...sections];
  const idleTickCount = idleTickCounts.get(username);
  if (idleTickCount !== undefined) {
    overviewSections.push({
      title: 'Idle Ticks',
      content: <IdleTicksContent count={idleTickCount} />,
    });
  }

  const spawn = challenge.spawns[stage];
  if (spawn !== undefined) {
    overviewSections.push({
      title: 'Spawn',
      content: (
        <SpawnContent
          type={ChallengeType.INFERNO}
          stage={stage}
          spawn={spawn}
        />
      ),
    });
  }

  return (
    <div className={styles.wavePage}>
      <div className={styles.overview}>
        <BossFightOverview
          name={stageName(stage)}
          image="/images/inferno.png"
          time={totalTicks}
          sections={overviewSections}
        />
      </div>

      <div className={styles.timeline}>
        <BossPageAttackTimeline
          currentTick={currentTick}
          playerState={playerState}
          updateTickOnPage={setTick}
          npcs={npcState}
          timeline={timeline}
          liveFollowing={following}
        />
      </div>

      <div className={styles.replayAndParty}>
        <BossPageReplay
          entities={getEntities(currentTick)}
          preloads={preloads}
          mapDef={mapDef}
          playing={playing}
          width={compact ? 340 : 800}
          height={compact ? 340 : 800}
          currentTick={currentTick}
          advanceTick={advanceTick}
        />
        <BossPageParty
          party={[username]}
          playerState={playerState}
          currentTick={currentTick}
          selectedActor={selectedActor}
          setSelectedActor={setSelectedActor}
        />
      </div>

      <BossPageControls
        currentlyPlaying={playing}
        firstTick={0}
        totalTicks={totalTicks}
        currentTick={currentTick}
        updateTick={setTick}
        updatePlayingState={setPlaying}
        splits={splits}
        following={following}
        onJumpToLive={isStreaming ? jumpToLive : undefined}
      />
    </div>
  );
}
