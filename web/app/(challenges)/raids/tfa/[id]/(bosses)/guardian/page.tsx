'use client';

import {
  Coords,
  EventType,
  Npc,
  NpcId,
  RoomNpcType,
  SplitType,
  Stage,
  stageName,
  TfaGuardianRocksEvent,
  TfaGuardianShroomsEvent,
  TfaRaid,
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
import { ticksToFormattedSeconds } from '@/utils/tick';

import {
  breathsOnTick,
  ENTITY_TEXTURES,
  guardianBreaths,
  GuardianShroom,
  guardianRocks,
  leapInterpolation,
  shroomsByTick,
} from './entities';

import bossStyles from '../style.module.scss';
import styles from './style.module.scss';

const GUARDIAN_MAP_DEFINITION: MapDefinition = {
  baseX: 4104,
  baseY: 5568,
  width: 48,
  height: 56,
  initialCameraPosition: { x: 4127, y: 5600 },
};

const GUARDIAN_ROOM_TERRAIN = new GridTerrain({ x: 4104, y: 5568 }, [
  '                   28.....28                    ',
  '                   #########                    ',
  '              #### 68.....2c ####               ',
  '             #....11.......11....#              ',
  '            #....#................#             ',
  '           #.44.................44.#            ',
  '          #.2##8...............2##8.#           ',
  '          8.2##8...............2##8.2           ',
  '          8..11.................11..2           ',
  ' 11##111##...........................##1111111  ',
  ' ..##...##...........................##....#..  ',
  ' .......##...........................##.......  ',
  ' ...##..##...........................##...#...  ',
  ' 444##44##...44.................44...##4444444  ',
  '          #####8...............2#####           ',
  '          8####8...............2##8.2           ',
  '         ###.1#.................#1.###          ',
  '         ###..#.................#..###          ',
  '         ###.##.................#..###          ',
  '         ###.##.................#4.###          ',
  '          8####8...............2##8.2           ',
  '          #####8...............2##8##           ',
  ' 11#1#11##...11.................11...##1111111  ',
  ' ..#....##...........................##...#...  ',
  ' .......##...........................##.......  ',
  ' .......##...........................##.....#.  ',
  ' 444#444##...44.................44...##4444444  ',
  '          ##2##8...............2#####           ',
  '          8.2##8...............2##8.2           ',
  '         ###.1#.................#1.###          ',
  '         ###..#.................#..###          ',
  '         ###..#.................#..###          ',
  '         ###.4#.................#4.###          ',
  '          8.2##8...............2##8.2           ',
  '          #####8...............2#####           ',
  ' 11##111##...11.................11...##11##111  ',
  ' ..##...##...........................##..##...  ',
  ' .......##...........................##.....#.  ',
  ' ...##..##...........................##.##....  ',
  ' 444##44##...........................##4##4444  ',
  '          8..44.................44..2           ',
  '          8.2##8...............2##8.2           ',
  '          #.2##8...............2##8.#           ',
  '           #.11##...............11##            ',
  '            #.....................#             ',
  '             #....4.........4....#              ',
  '              #### #.......# ####               ',
  '                    8.....28                    ',
  '                   #.......#                    ',
  '                   #.......#                    ',
  '                   #.......#                    ',
  '                   #.......#                    ',
  '                    8.....28                    ',
  '                    #.....#8                    ',
  '                    #.....#8                    ',
  '                                                ',
]);

class GuardianTerrain implements Terrain {
  constructor(readonly npc: NpcState | null) {}

  isPassable(coords: Coords): boolean {
    if (
      this.npc?.id !== NpcId.ARCHIVE_GUARDIAN_UNSHIELDED ||
      (this.npc.properties.type === RoomNpcType.GUARDIAN &&
        this.npc.properties.value.enraged)
    ) {
      return GUARDIAN_ROOM_TERRAIN.isPassable(coords);
    }

    return (
      !inRect(coords, {
        ...this.npc.position,
        width: this.npc.size,
        height: this.npc.size,
      }) && GUARDIAN_ROOM_TERRAIN.isPassable(coords)
    );
  }
}

export default function GuardianPage() {
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
  } = useStageEvents<TfaRaid>(Stage.TFA_GUARDIAN);

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
  } = usePlayingState(1, totalTicks, isStreaming);

  const roomMapDefinition = useMemo(
    () => ({
      ...GUARDIAN_MAP_DEFINITION,
      terrain: GUARDIAN_ROOM_TERRAIN,
      initialZoom: compact ? 11 : 21,
    }),
    [compact],
  );

  const guardianNpc = useMemo(
    () =>
      npcState.values().find((npc) => Npc.isArchiveGuardian(npc.spawnNpcId)),
    [npcState],
  );

  const mapDefinitions = useMemo(
    () =>
      Array.from({ length: totalTicks }, (_, tick) => ({
        ...roomMapDefinition,
        terrain: new GuardianTerrain(guardianNpc?.stateByTick[tick] ?? null),
      })),
    [roomMapDefinition, guardianNpc, totalTicks],
  );

  const { selectedActor, setSelectedActor } = useContext(ActorContext);

  const modifyEntity = useCallback(
    (tick: number, entity: AnyEntity) => {
      if (entity.type !== EntityType.NPC) {
        return entity;
      }

      const npcEntity = entity as NpcEntity;
      const npc = npcState.get(npcEntity.roomId);
      if (npc !== undefined) {
        npcEntity.options.customInterpolation = leapInterpolation(npc, tick);
      }
      return entity;
    },
    [npcState],
  );

  const rocksEvents = useStableEvents<TfaGuardianRocksEvent>(
    eventsByType,
    EventType.TFA_GUARDIAN_ROCKS,
  );

  const shroomsEvents = useStableEvents<TfaGuardianShroomsEvent>(
    eventsByType,
    EventType.TFA_GUARDIAN_SHROOMS,
  );

  const shrooms = useMemo(
    () => shroomsByTick(shroomsEvents, totalTicks),
    [shroomsEvents, totalTicks],
  );

  const breaths = useMemo(
    () =>
      guardianNpc !== undefined
        ? guardianBreaths(guardianNpc, playerState, totalTicks)
        : [],
    [guardianNpc, playerState, totalTicks],
  );

  const customEntitiesForTick = useCallback(
    (tick: number): AnyEntity[] => {
      const entities: AnyEntity[] = (shrooms[tick] ?? []).map(
        (shroom) => new GuardianShroom(shroom),
      );
      if (guardianNpc !== undefined) {
        entities.push(...guardianRocks(guardianNpc, tick, rocksEvents));
        entities.push(...breathsOnTick(guardianNpc, tick, breaths));
      }
      return entities;
    },
    [guardianNpc, rocksEvents, shrooms, breaths],
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

  const guardian = challenge.tfa.bosses.find(
    (boss) => boss.stage === Stage.TFA_GUARDIAN,
  );
  if (!isLive && guardian === undefined) {
    return <MissingStageData stage={Stage.TFA_GUARDIAN} />;
  }

  const sections: BossFightOverviewSection[] = [];

  const enrageTick = challenge.splits[SplitType.TFA_GUARDIAN_ENRAGE];
  if (enrageTick !== undefined) {
    sections.push({
      title: 'Splits',
      content: (
        <div className={styles.phaseTimes}>
          <div className={styles.phaseTime}>
            <span className={styles.phaseLabel}>Enrage</span>
            <button
              className={styles.phaseValue}
              onClick={() => setTick(enrageTick)}
            >
              {ticksToFormattedSeconds(enrageTick)}
            </button>
          </div>
        </div>
      ),
    });
  }

  return (
    <>
      <div className={bossStyles.overview}>
        <BossFightOverview
          name={stageName(Stage.TFA_GUARDIAN)}
          image="/images/tfa/guardian.webp"
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
          width={compact ? 320 : 600}
          height={compact ? 560 : 840}
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
        splits={splits}
        following={following}
        onJumpToLive={isStreaming ? jumpToLive : undefined}
      />
    </>
  );
}
