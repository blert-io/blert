'use client';

import {
  Coords,
  EventType,
  NpcId,
  Stage,
  stageName,
  TfaRaid,
  TfaXarthBlastEvent,
  TfaXarthBombsEvent,
  TfaXarthCorpseLeakEvent,
  TfaXarthFiresEvent,
} from '@blert/common';
import { useCallback, useContext, useMemo } from 'react';

import { ActorContext } from '@/(challenges)/raids/tfa/context';
import BossFightOverview, {
  BossFightOverviewSection,
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
  GridTerrain,
  MapDefinition,
  NpcEntity,
  Terrain,
} from '@/components/map-renderer';
import MissingStageData from '@/components/missing-stage-data';
import { useDisplay } from '@/display';
import {
  NpcState,
  useMapEntities,
  usePlayingState,
  usePreloads,
  useStableEvents,
  useStageEvents,
} from '@/utils/boss-room-state';
import { inRect } from '@/utils/coords';

import {
  bindsOnTick,
  blastsOnTick,
  corpseLeaksByTick,
  ENTITY_TEXTURES,
  firesByTick,
  XarthPillar,
} from './entities';

import bossStyles from '../style.module.scss';
import styles from './style.module.scss';

const XARTH_MAP_DEFINITION: MapDefinition = {
  baseX: 4168,
  baseY: 5512,
  width: 48,
  height: 48,
  initialCameraPosition: { x: 4190, y: 5535 },
};

const XARTH_ROOM_TERRAIN = new GridTerrain({ x: 4168, y: 5512 }, [
  '                                                ',
  '                                                ',
  '                                                ',
  '                                                ',
  '                                                ',
  '                                                ',
  '      #.###                         ###.#       ',
  '     #.....#       ####4####       #..#..#      ',
  '     .....44#111155....1....551111#4#.....      ',
  '     #...###....2##8.......2##8....15#...#      ',
  '     #..###8....2##8.......2##8....2###..#      ',
  '     #.2a##8.....11.........11.....2##a8.#      ',
  '      #2811........#...........#...#112##       ',
  '       #....#######################....#        ',
  '       8....#######################....2        ',
  '       8....#######################....2        ',
  '       8...####91111111111111113###....2        ',
  '       844..###8...............2###..442        ',
  '       a##8.###8...............2###.2##a        ',
  '       a##8.###8...............2###.2##a        ',
  '       811..###8...............2###..11.#       ',
  '      #.....###8...............2###.....#       ',
  '###111......###8...............2###.....#       ',
  '###.........###8...............2###.....#       ',
  '###.......#.###8...............2###....28       ',
  '###.........###8...............2###.....#       ',
  '###444......###8...............2###.....#       ',
  '      #.....###8...............2###.....#       ',
  '       844..###8...............2###..44.#       ',
  '       a##8.###8...............2###.2##a        ',
  '       a##8.###8...............2###.2##a        ',
  '       811..###8...............2###..112        ',
  '       8....###c4444444444444446###....2        ',
  '       8...#########################...2        ',
  '       8....#######################....2        ',
  '       #....#######################....#        ',
  '      ##844............#...........#44#8#       ',
  '     ###a##8.....44.........44.....2###8.#      ',
  '     #..###8....2##8.......2##8....2###.##      ',
  '     #...#54....2##8.......2##8....45#...#      ',
  '     .....#1#444455....4....554444##1##...      ',
  '     #.....#       ####1####       #.##..#      ',
  '      #.###                         ###.#       ',
  '                                                ',
  '                                                ',
  '                                                ',
  '                                                ',
  '                                                ',
]);

class XarthTerrain implements Terrain {
  constructor(readonly pillars: NpcState[]) {}

  isPassable(coords: Coords): boolean {
    return (
      this.pillars.every(
        (pillar) =>
          !inRect(coords, {
            ...pillar.position,
            width: pillar.size,
            height: pillar.size,
          }),
      ) && XARTH_ROOM_TERRAIN.isPassable(coords)
    );
  }
}

export default function XarthPage() {
  const display = useDisplay();

  const compact = display.isCompact();

  const {
    challenge,
    totalTicks,
    playerState,
    npcState,
    eventsByType,
    bcf,
    loading,
    isLive,
    isStreaming,
  } = useStageEvents<TfaRaid>(Stage.TFA_XARTH);

  const timeline = useBossPageTimeline(bcf);

  const {
    currentTick,
    setTick,
    playing,
    setPlaying,
    advanceTick,
    following,
    jumpToLive,
  } = usePlayingState(1, totalTicks, isStreaming);

  const roomMapDefinition = useMemo(
    () => ({
      ...XARTH_MAP_DEFINITION,
      terrain: XARTH_ROOM_TERRAIN,
      initialZoom: compact ? 10.5 : 20,
    }),
    [compact],
  );

  const pillarNpcs = useMemo(
    () =>
      npcState
        .values()
        .filter((npc) => (npc.spawnNpcId as NpcId) === NpcId.XARTH_PILLAR)
        .toArray(),
    [npcState],
  );

  const mapDefinitions = useMemo(
    () =>
      Array.from({ length: totalTicks }, (_, tick) => ({
        ...roomMapDefinition,
        terrain: new XarthTerrain(
          pillarNpcs.flatMap((npc) => npc.stateByTick[tick] ?? []),
        ),
      })),
    [roomMapDefinition, pillarNpcs, totalTicks],
  );

  const { selectedActor, setSelectedActor } = useContext(ActorContext);

  const xarthNpc = useMemo(
    () =>
      npcState
        .values()
        .find((npc) => (npc.spawnNpcId as NpcId) === NpcId.XARTH),
    [npcState],
  );

  const bombsEvents = useStableEvents<TfaXarthBombsEvent>(
    eventsByType,
    EventType.TFA_XARTH_BOMBS,
  );

  const blastEvents = useStableEvents<TfaXarthBlastEvent>(
    eventsByType,
    EventType.TFA_XARTH_BLAST,
  );

  const firesEvents = useStableEvents<TfaXarthFiresEvent>(
    eventsByType,
    EventType.TFA_XARTH_FIRES,
  );
  const fires = useMemo(
    () => firesByTick(firesEvents, totalTicks),
    [firesEvents, totalTicks],
  );

  const corpseLeakEvents = useStableEvents<TfaXarthCorpseLeakEvent>(
    eventsByType,
    EventType.TFA_XARTH_CORPSE_LEAK,
  );
  const corpseLeaks = useMemo(
    () =>
      xarthNpc === undefined
        ? []
        : corpseLeaksByTick(xarthNpc, npcState, corpseLeakEvents, totalTicks),
    [xarthNpc, npcState, corpseLeakEvents, totalTicks],
  );

  const modifyEntity = useCallback(
    (tick: number, entity: AnyEntity) => {
      if (entity.type !== EntityType.NPC) {
        return entity;
      }

      const npcEntity = entity as NpcEntity;
      const pillar = pillarNpcs.find((npc) => npc.roomId === npcEntity.roomId);
      if (pillar === undefined) {
        return entity;
      }
      return new XarthPillar(npcEntity, pillar.dyingTick, tick);
    },
    [pillarNpcs],
  );

  const customEntitiesForTick = useCallback(
    (tick: number): AnyEntity[] => {
      const entities: AnyEntity[] = [
        ...(fires[tick] ?? []),
        ...(corpseLeaks[tick] ?? []),
      ];
      if (xarthNpc !== undefined) {
        entities.push(
          ...bindsOnTick(xarthNpc, tick, playerState, bombsEvents),
          ...blastsOnTick(xarthNpc, tick, blastEvents),
        );
      }
      return entities;
    },
    [fires, corpseLeaks, xarthNpc, playerState, bombsEvents, blastEvents],
  );

  const getEntities = useMapEntities(
    challenge,
    playerState,
    npcState,
    totalTicks,
    { modifyEntity, customEntitiesForTick },
  );
  const npcPreloads = usePreloads(npcState, isLive);
  const preloads = useMemo(
    () => [...npcPreloads, ...ENTITY_TEXTURES],
    [npcPreloads],
  );

  if (loading || challenge === null) {
    return <Loading />;
  }

  const xarth = challenge.tfa.bosses.find(
    (boss) => boss.stage === Stage.TFA_XARTH,
  );
  if (!isLive && xarth === undefined) {
    return <MissingStageData stage={Stage.TFA_XARTH} />;
  }

  const sections: BossFightOverviewSection[] = [];

  const { xarthCorpsesLeaked, xarthP2Blasts } = challenge.tfaStats;
  if (xarthCorpsesLeaked !== null) {
    const corpsesSpawned = npcState
      .values()
      .filter((npc) => (npc.spawnNpcId as NpcId) === NpcId.XARTH_CORPSE)
      .toArray().length;
    sections.push({
      title: 'Stats',
      content: (
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Corpses spawned</span>
            <span className={styles.statValue}>{corpsesSpawned}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Corpses leaked</span>
            <span className={styles.statValue}>{xarthCorpsesLeaked}</span>
          </div>
          {xarthP2Blasts !== null && xarthP2Blasts > 0 && (
            <div className={styles.stat}>
              <span className={styles.statLabel}>Blasts during P2</span>
              <span className={styles.statValue}>{xarthP2Blasts}</span>
            </div>
          )}
        </div>
      ),
    });
  }

  return (
    <>
      <div className={bossStyles.overview}>
        <BossFightOverview
          name={stageName(Stage.TFA_XARTH)}
          image="/images/tfa/xarth.webp"
          time={totalTicks}
          sections={sections}
        />
      </div>

      <div className={bossStyles.timeline}>
        <BossPageAttackTimeline
          currentTick={currentTick}
          playerState={playerState}
          updateTickOnPage={setTick}
          npcs={npcState}
          timeline={timeline}
          liveFollowing={following}
        />
      </div>

      <div className={bossStyles.replayAndParty}>
        <BossPageReplay
          entities={getEntities(currentTick)}
          preloads={preloads}
          mapDef={mapDefinitions[currentTick] ?? roomMapDefinition}
          playing={playing}
          width={compact ? 340 : 800}
          height={compact ? 220 : 500}
          currentTick={currentTick}
          advanceTick={advanceTick}
        />
        <BossPageParty
          party={challenge.party.map((player) => player.username)}
          playerState={playerState}
          currentTick={currentTick}
          selectedActor={selectedActor}
          setSelectedActor={setSelectedActor}
        />
      </div>

      <BossPageControls
        currentlyPlaying={playing}
        firstTick={1}
        totalTicks={totalTicks}
        currentTick={currentTick}
        updateTick={setTick}
        updatePlayingState={setPlaying}
        following={following}
        onJumpToLive={isStreaming ? jumpToLive : undefined}
      />
    </>
  );
}
