'use client';

import { Stage, stageName, TfaRaid } from '@blert/common';
import { useContext, useMemo } from 'react';

import { ActorContext } from '@/(challenges)/raids/tfa/context';
import BossFightOverview from '@/components/boss-fight-overview';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import BossPageControls from '@/components/boss-page-controls';
import BossPageParty from '@/components/boss-page-party';
import BossPageReplay from '@/components/boss-page-replay';
import Loading from '@/components/loading';
import { MapDefinition } from '@/components/map-renderer';
import MissingStageData from '@/components/missing-stage-data';
import { useDisplay } from '@/display';
import {
  useMapEntities,
  usePlayingState,
  usePreloads,
  useStageEvents,
} from '@/utils/boss-room-state';

import bossStyles from '../style.module.scss';

const OCELLUS_MAP_DEFINITION: MapDefinition = {
  baseX: 4096,
  baseY: 5632,
  width: 64,
  height: 64,
  plane: 1,
  initialCameraPosition: { x: 4127, y: 5673 },
};

export default function OcellusPage() {
  const display = useDisplay();

  const compact = display.isCompact();

  const mapDefinition = useMemo(() => {
    const initialZoom = compact ? 12.5 : 22;
    return {
      ...OCELLUS_MAP_DEFINITION,
      initialZoom,
    };
  }, [compact]);

  const {
    challenge,
    totalTicks,
    playerState,
    npcState,
    bcf,
    loading,
    isLive,
    isStreaming,
  } = useStageEvents<TfaRaid>(Stage.TFA_OCELLUS);

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

  const getEntities = useMapEntities(
    challenge,
    playerState,
    npcState,
    totalTicks,
  );
  const preloads = usePreloads(npcState, isLive);

  if (loading || challenge === null) {
    return <Loading />;
  }

  const ocellus = challenge.tfa.bosses.find(
    (boss) => boss.stage === Stage.TFA_OCELLUS,
  );
  if (!isLive && ocellus === undefined) {
    return <MissingStageData stage={Stage.TFA_OCELLUS} />;
  }

  const playerTickState = challenge.party.reduce(
    (acc, { username }) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  return (
    <>
      <div className={bossStyles.overview}>
        <BossFightOverview
          name={stageName(Stage.TFA_OCELLUS)}
          image="/images/tfa/ocellus.webp"
          time={totalTicks}
        />
      </div>

      <div className={bossStyles.timeline}>
        <BossPageAttackTimeline
          currentTick={currentTick}
          playerState={playerState}
          updateTickOnPage={setTick}
          npcs={npcState}
          bcf={bcf}
          liveFollowing={following}
        />
      </div>

      <div className={bossStyles.replayAndParty}>
        <BossPageReplay
          entities={getEntities(currentTick)}
          preloads={preloads}
          mapDef={mapDefinition}
          playing={playing}
          width={compact ? 340 : 600}
          height={compact ? 340 : 600}
          currentTick={currentTick}
          advanceTick={advanceTick}
        />
        <BossPageParty
          playerTickState={playerTickState}
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
