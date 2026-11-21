'use client';

import {
  BorkSpeed,
  EventType,
  NpcAttack,
  NpcId,
  Stage,
  stageName,
  TfaBorkBombEvent,
  TfaBorkCannonAutoEvent,
  TfaBorkDustEvent,
  TfaBorkNapalmEvent,
  TfaBorkSpeedupEvent,
  TfaBorkStunEvent,
  TfaRaid,
} from '@blert/common';
import { useGLTF } from '@react-three/drei';
import { useCallback, useContext, useEffect, useMemo } from 'react';

import { ActorContext } from '@/(challenges)/raids/tfa/context';
import BossFightOverview from '@/components/boss-fight-overview';
import BossPageAttackTimeline, {
  useBossPageTimeline,
} from '@/components/boss-page-attack-timeline';
import BossPageControls from '@/components/boss-page-controls';
import BossPageParty from '@/components/boss-page-party';
import BossPageReplay from '@/components/boss-page-replay';
import Loading from '@/components/loading';
import {
  AnyEntity,
  CYCLES_PER_TICK,
  EntityType,
  MapDefinition,
  NpcEntity,
  overheadTextByTick,
  spriteAnimationPlaysOnTick,
} from '@/components/map-renderer';
import MissingStageData from '@/components/missing-stage-data';
import { useDisplay } from '@/display';
import {
  useMapEntities,
  usePlayingState,
  usePreloads,
  useStableEvents,
  useStageEvents,
} from '@/utils/boss-room-state';

import {
  bombsByTick,
  BORK_STUN,
  cannonAutosByTick,
  dustByTick,
  ENTITY_MODELS,
  ENTITY_TEXTURES,
  napalmByTick,
} from './entities';

import bossStyles from '../style.module.scss';

const BORK_MAP_DEFINITION: MapDefinition = {
  baseX: 4168,
  baseY: 5584,
  width: 48,
  height: 32,
  initialCameraPosition: { x: 4191, y: 5599 },
};

const SPEEDUP_LINES = new Map([
  [BorkSpeed.FAST, { smorks: 'Smorks go faster!', bork: 'Bork get into it!' }],
  [
    BorkSpeed.FASTER,
    { smorks: 'Smorks feeling drum beat now!', bork: 'Bork make fast drum!' },
  ],
  [
    BorkSpeed.FASTEST,
    { smorks: 'Smorks go fastest!', bork: 'Bork maximum crush!' },
  ],
]);

export default function BorkPage() {
  const display = useDisplay();

  const compact = display.isCompact();

  const mapDefinition = useMemo(() => {
    const initialZoom = compact ? 10.5 : 22;
    return {
      ...BORK_MAP_DEFINITION,
      initialZoom,
    };
  }, [compact]);

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
  } = useStageEvents<TfaRaid>(Stage.TFA_BORK);

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

  const { selectedActor, setSelectedActor } = useContext(ActorContext);

  const dustEvents = useStableEvents<TfaBorkDustEvent>(
    eventsByType,
    EventType.TFA_BORK_DUST,
  );
  const dust = useMemo(
    () => dustByTick(dustEvents, totalTicks),
    [dustEvents, totalTicks],
  );

  const borkNpc = useMemo(
    () =>
      npcState
        .values()
        .find((npc) => (npc.spawnNpcId as NpcId) === NpcId.BORK) ?? null,
    [npcState],
  );

  const smorksNpc = useMemo(
    () =>
      npcState
        .values()
        .find((npc) => (npc.spawnNpcId as NpcId) === NpcId.THE_SMORKS) ?? null,
    [npcState],
  );

  const napalmEvents = useStableEvents<TfaBorkNapalmEvent>(
    eventsByType,
    EventType.TFA_BORK_NAPALM,
  );
  const napalm = useMemo(
    () => napalmByTick(smorksNpc, playerState, napalmEvents, totalTicks),
    [smorksNpc, playerState, napalmEvents, totalTicks],
  );

  const cannonAutoEvents = useStableEvents<TfaBorkCannonAutoEvent>(
    eventsByType,
    EventType.TFA_BORK_CANNON_AUTO,
  );
  const cannonAutos = useMemo(
    () =>
      smorksNpc === null
        ? []
        : cannonAutosByTick(smorksNpc, cannonAutoEvents, totalTicks),
    [smorksNpc, cannonAutoEvents, totalTicks],
  );

  const bombEvents = useStableEvents<TfaBorkBombEvent>(
    eventsByType,
    EventType.TFA_BORK_BOMB,
  );
  const bombs = useMemo(
    () =>
      smorksNpc === null ? [] : bombsByTick(smorksNpc, bombEvents, totalTicks),
    [smorksNpc, bombEvents, totalTicks],
  );

  const customEntitiesForTick = useCallback(
    (tick: number): AnyEntity[] => [
      ...(napalm[tick] ?? []),
      ...(dust[tick] ?? []),
      ...(cannonAutos[tick] ?? []),
      ...(bombs[tick] ?? []),
    ],
    [napalm, dust, cannonAutos, bombs],
  );

  const speedupEvents = useStableEvents<TfaBorkSpeedupEvent>(
    eventsByType,
    EventType.TFA_BORK_SPEEDUP,
  );

  const overheadTexts = useMemo(() => {
    const speedups = speedupEvents.flatMap(({ tick, tfaBorkSpeedup }) => {
      const lines = SPEEDUP_LINES.get(tfaBorkSpeedup.speed);
      return lines === undefined ? [] : [{ tick, ...lines }];
    });

    const texts = new Map<number, (string | null)[]>();
    if (smorksNpc !== null) {
      const bigBombs = smorksNpc.stateByTick.flatMap((state, tick) =>
        state?.attack?.attack === NpcAttack.TFA_SMORKS_CANNONBALL
          ? [{ tick: tick - 2, text: 'Big bomb! Bork watch out!' }]
          : [],
      );
      texts.set(
        smorksNpc.roomId,
        overheadTextByTick(
          [
            ...speedups.map(({ tick, smorks }) => ({ tick, text: smorks })),
            ...bigBombs,
          ],
          totalTicks,
        ),
      );
    }
    if (borkNpc !== null) {
      texts.set(
        borkNpc.roomId,
        overheadTextByTick(
          speedups.map(({ tick, bork }) => ({ tick, text: bork })),
          totalTicks,
        ),
      );
    }
    return texts;
  }, [borkNpc, smorksNpc, speedupEvents, totalTicks]);

  const stunEvents = useStableEvents<TfaBorkStunEvent>(
    eventsByType,
    EventType.TFA_BORK_STUN,
  );

  const modifyEntity = useCallback(
    (tick: number, entity: AnyEntity) => {
      if (entity.type !== EntityType.NPC) {
        return entity;
      }
      const npcEntity = entity as NpcEntity;
      npcEntity.overheadText =
        overheadTexts.get(npcEntity.roomId)?.[tick] ?? null;
      if (npcEntity.roomId === borkNpc?.roomId) {
        npcEntity.spotAnims = stunEvents
          .map((event) => event.tick * CYCLES_PER_TICK)
          .filter((startCycle) =>
            spriteAnimationPlaysOnTick(tick, startCycle, BORK_STUN),
          )
          .map((startCycle) => ({
            animation: BORK_STUN,
            startCycle,
            scale: 0.8,
          }));
      }
      return npcEntity;
    },
    [borkNpc, overheadTexts, stunEvents],
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

  useEffect(() => {
    useGLTF.preload(ENTITY_MODELS);
  }, []);

  if (loading || challenge === null) {
    return <Loading />;
  }

  const bork = challenge.tfa.bosses.find(
    (boss) => boss.stage === Stage.TFA_BORK,
  );
  if (!isLive && bork === undefined) {
    return <MissingStageData stage={Stage.TFA_BORK} />;
  }

  return (
    <>
      <div className={bossStyles.overview}>
        <BossFightOverview
          name={stageName(Stage.TFA_BORK)}
          image="/images/tfa/bork.webp"
          time={totalTicks}
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
          mapDef={mapDefinition}
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
