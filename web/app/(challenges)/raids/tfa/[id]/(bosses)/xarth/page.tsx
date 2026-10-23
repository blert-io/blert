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

const XARTH_MAP_DEFINITION: MapDefinition = {
  baseX: 4168,
  baseY: 5512,
  width: 48,
  height: 48,
  initialCameraPosition: { x: 4190, y: 5535 },
};

export default function XarthPage() {
  const display = useDisplay();

  const compact = display.isCompact();

  const mapDefinition = useMemo(() => {
    const initialZoom = compact ? 10.5 : 20;
    return {
      ...XARTH_MAP_DEFINITION,
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
  } = useStageEvents<TfaRaid>(Stage.TFA_XARTH);

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

  const xarth = challenge.tfa.bosses.find(
    (boss) => boss.stage === Stage.TFA_XARTH,
  );
  if (!isLive && xarth === undefined) {
    return <MissingStageData stage={Stage.TFA_XARTH} />;
  }

  return (
    <>
      <div className={bossStyles.overview}>
        <BossFightOverview
          name={stageName(Stage.TFA_XARTH)}
          image="/images/tfa/xarth.webp"
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
