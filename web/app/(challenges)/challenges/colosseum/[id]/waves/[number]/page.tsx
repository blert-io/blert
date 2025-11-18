'use client';

import {
  ChallengeType,
  ColosseumChallenge,
  EventType,
  HANDICAP_LEVEL_VALUE_INCREMENT,
  Handicap,
  Npc,
  NpcEvent,
  PlayerUpdateEvent,
  SkillLevel,
  Stage,
} from '@blert/common';
import { notFound, useRouter } from 'next/navigation';
import {
  use,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import BossFightOverview from '@/components/boss-fight-overview';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import BossPageControls from '@/components/boss-page-controls';
import BossPageParty from '@/components/boss-page-party';
import BossPageReplay, {
  NewBossPageReplay,
} from '@/components/boss-page-replay';
import ColosseumHandicap from '@/components/colosseum-handicap';
import Loading from '@/components/loading';
import {
  Entity as LegacyEntity,
  NpcEntity as LegacyNpcEntity,
  PlayerEntity as LegacyPlayerEntity,
} from '@/components/map';
import { MapDefinition, ObjectEntity } from '@/components/map-renderer';
import { useDisplay } from '@/display';
import {
  useLegacyTickTimeout,
  useMapEntities,
  usePlayingState,
  useStageEvents,
} from '@/utils/boss-room-state';
import { challengeUrl } from '@/utils/url';

import { ActorContext } from '../../../context';

import styles from './style.module.scss';
import colosseumBaseTiles from './colosseum-tiles.json';

const COLOSSEUM_MAP_DEFINITION: MapDefinition = {
  baseX: 1792,
  baseY: 3072,
  width: 64,
  height: 64,
  initialCameraPosition: { x: 1824.5, y: 3107 },
};

const LEGACY_COLOSSEUM_MAP_DEFINITION = {
  baseX: 1808,
  baseY: 3090,
  width: 34,
  height: 34,
  baseTiles: colosseumBaseTiles,
};

function imageForWave(waveNumber: number) {
  return waveNumber === 12
    ? '/images/colosseum/sol-heredit.webp'
    : `/images/colosseum/wave-${waveNumber}.webp`;
}

type ColosseumWavePageProps = {
  params: Promise<{ id: string; number: string }>;
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

const PILLARS = [
  { x: 1816, y: 3098 },
  { x: 1831, y: 3098 },
  { x: 1816, y: 3113 },
  { x: 1831, y: 3113 },
];

const DEFAULT_USE_NEW_REPLAY = true;

export default function ColosseumWavePage({ params }: ColosseumWavePageProps) {
  const router = useRouter();
  const display = useDisplay();
  const [useNewReplay, setUseNewReplay] = useState(DEFAULT_USE_NEW_REPLAY);

  const compact = display.isCompact();

  const mapDef = useMemo(() => {
    const initialZoom = compact ? 15 : 28;
    return {
      ...COLOSSEUM_MAP_DEFINITION,
      initialZoom,
    };
  }, [compact]);

  const { id: challengeId, number } = use(params);

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
    loading,
  } = useStageEvents<ColosseumChallenge>(Stage.COLOSSEUM_WAVE_1 + waveIndex);

  const { selectedPlayer, setSelectedPlayer } = useContext(ActorContext);

  const { currentTick, setTick, playing, setPlaying, advanceTick } =
    usePlayingState(totalTicks);
  const { updateTickOnPage } = useLegacyTickTimeout(
    !useNewReplay,
    playing,
    currentTick,
    setTick,
  );

  const customEntitiesForTick = useCallback(
    (_: number) =>
      PILLARS.map(
        (pillar) =>
          new ObjectEntity(
            pillar,
            '/images/colosseum/pillar.png',
            'Colosseum Pillar',
            3,
            '#603025',
          ),
      ),
    [],
  );

  const { entitiesByTick, preloads } = useMapEntities(
    challenge,
    playerState,
    npcState,
    totalTicks,
    { customEntitiesForTick },
  );

  if (challenge === null || loading) {
    return <Loading />;
  }

  const waveInfo = challenge.colosseum.waves[waveNumber - 1];
  if (waveInfo === undefined) {
    notFound();
  }

  const title = waveNumber === 12 ? 'Sol Heredit' : `Wave ${waveNumber}`;

  // Collect all the handicaps that have been selected up to this wave.
  const handicapsSoFar: Handicap[] = [];
  for (let i = 0; i < waveNumber; i++) {
    const handicap = challenge.colosseum.waves[i].handicap;
    const previousLevelHandicap = (handicap -
      HANDICAP_LEVEL_VALUE_INCREMENT) as Handicap;
    const index: number = handicapsSoFar.findIndex(
      (existingHandicap) =>
        existingHandicap === handicap ||
        existingHandicap === previousLevelHandicap,
    );
    if (index === -1) {
      handicapsSoFar.push(handicap);
    } else {
      handicapsSoFar[index] = handicap;
    }
  }

  const eventsForCurrentTick = eventsByTick[currentTick] ?? [];

  const legacyEntities: LegacyEntity[] = [];

  for (const evt of eventsForCurrentTick) {
    switch (evt.type) {
      case EventType.PLAYER_UPDATE: {
        const e = evt as PlayerUpdateEvent;
        const hitpoints = e.player.hitpoints
          ? SkillLevel.fromRaw(e.player.hitpoints)
          : undefined;
        const player = new LegacyPlayerEntity(
          e.xCoord,
          e.yCoord,
          e.player.name,
          hitpoints,
          /*highlight=*/ e.player.name === selectedPlayer,
        );
        legacyEntities.push(player);
        break;
      }
      case EventType.NPC_SPAWN:
      case EventType.NPC_UPDATE: {
        const e = evt as NpcEvent;
        legacyEntities.push(
          new LegacyNpcEntity(
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

  const username = challenge.party[0].username;
  const playerTickState = {
    [username]: playerState.get(username)?.at(currentTick) ?? null,
  };

  const timelineSplits: { tick: number; splitName: string }[] = [];
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

  const sections = [];
  sections.push({
    title: 'Handicaps This Wave',
    content: (
      <div className={styles.handicapOptions}>
        {waveInfo.options.map((option) => (
          <div className={styles.handicapOption} key={option}>
            <ColosseumHandicap
              handicap={option}
              dimmed={option !== waveInfo.handicap}
            />
          </div>
        ))}
      </div>
    ),
  });

  if (handicapsSoFar.length > 0) {
    sections.push({
      title: 'All Active Handicaps',
      content: (
        <div className={styles.handicapOptions}>
          {handicapsSoFar.map((handicap) => (
            <div className={styles.handicapOption} key={handicap}>
              <ColosseumHandicap handicap={handicap} />
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
          image={imageForWave(waveNumber)}
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
          updateTickOnPage={updateTickOnPage}
          splits={timelineSplits}
          npcs={npcState}
          smallLegend={display.isCompact()}
        />
      </div>

      <div className={styles.replayAndParty}>
        {useNewReplay ? (
          <NewBossPageReplay
            entities={entitiesByTick.get(currentTick) ?? []}
            preloads={preloads}
            mapDef={mapDef}
            playing={playing}
            width={compact ? 340 : 800}
            height={compact ? 340 : 800}
            currentTick={currentTick}
            advanceTick={advanceTick}
            setUseLegacy={() => setUseNewReplay(false)}
          />
        ) : (
          <BossPageReplay
            entities={legacyEntities}
            mapDef={LEGACY_COLOSSEUM_MAP_DEFINITION}
            tileSize={compact ? 12 : 20}
          />
        )}
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
        updateTick={updateTickOnPage}
        updatePlayingState={setPlaying}
        splits={timelineSplits}
      />
    </div>
  );
}
