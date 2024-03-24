'use client';

import {
  ChallengeStatus,
  EventType,
  Npc,
  NpcAttack,
  NpcAttackEvent,
  NpcEvent,
  NpcId,
  PlayerEvent,
  PlayerUpdateEvent,
  Stage,
  isPlayerEvent,
} from '@blert/common';
import Image from 'next/image';

import {
  getPlayerDetails,
  usePlayingState,
  useRoomEvents,
} from '../../../boss-room-state';
import { BossPageControls } from '../../../../../components/boss-page-controls/boss-page-controls';
import { BossPageAttackTimeline } from '../../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import BossPageReplay from '../../../../../components/boss-page-replay';
import { Entity, NpcEntity, PlayerEntity } from '../../../../../components/map';
import Loading from '../../../../../components/loading';

import styles from './style.module.scss';
import verzikBaseTiles from './verzik-tiles.json';
import { useContext, useMemo } from 'react';
import { ActorContext } from '../../../context';
import { ticksToFormattedSeconds } from '../../../../../utils/tick';

const VERZIK_MAP_DEFINITION = {
  baseX: 3154,
  baseY: 4302,
  width: 29,
  height: 25,
  baseTiles: verzikBaseTiles,
};

function verzikNpcColor(npcId: number): string | undefined {
  if (Npc.isVerzikIschyros(npcId)) {
    return '#a9aaab';
  }
  if (Npc.isVerzikToxobolos(npcId)) {
    return '#408d43';
  }
  if (Npc.isVerzikHagios(npcId)) {
    return '#42c6d7';
  }
  if (Npc.isVerzikAthanatos(npcId)) {
    return '#69178f';
  }
  if (Npc.isVerzikMatomenos(npcId)) {
    return '#c51111';
  }

  if (npcId === NpcId.VERZIK_PILLAR) {
    return '#6f11c5';
  }
  return undefined;
}

export default function VerzikPage() {
  const {
    raidData,
    totalTicks,
    eventsByTick,
    eventsByType,
    bossAttackTimeline,
    playerAttackTimelines,
    loading,
  } = useRoomEvents(Stage.TOB_VERZIK);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const { selectedPlayer } = useContext(ActorContext);

  const [splits, backgroundColors] = useMemo(() => {
    let splits = [];
    const verzik = raidData?.rooms.verzik;
    if (verzik) {
      if (verzik.splits.p1 > 0) {
        splits.push({
          tick: verzik.splits.p1,
          splitName: 'P1 End',
          unimportant: true,
        });
        splits.push({ tick: verzik.splits.p1 + 13, splitName: 'P2' });
      }
      if (verzik.splits.reds > 0) {
        splits.push({ tick: verzik.splits.reds, splitName: 'Reds' });
      }
      if (verzik.splits.p2 > 0) {
        splits.push({
          tick: verzik.splits.p2,
          splitName: 'P2 End',
          unimportant: true,
        });
        splits.push({ tick: verzik.splits.p2 + 6, splitName: 'P3' });
      }
    }

    const backgroundColors = eventsByType[EventType.NPC_ATTACK]
      ?.filter(
        (event) =>
          (event as NpcAttackEvent).npcAttack.attack ===
          NpcAttack.TOB_VERZIK_P1_AUTO,
      )
      .map((event) => ({ tick: event.tick, backgroundColor: '#512020' }));

    return [splits, backgroundColors];
  }, [raidData, eventsByType]);

  if (loading || raidData === null) {
    return <Loading />;
  }

  const verzikData = raidData.rooms.verzik;
  if (raidData.status !== ChallengeStatus.IN_PROGRESS && verzikData === null) {
    return <>No Verzik data for this raid</>;
  }

  const eventsForCurrentTick = eventsByTick[currentTick] ?? [];

  let entities: Entity[] = [];
  const players: PlayerEntity[] = [];

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
        entities.push(
          new NpcEntity(
            e.xCoord,
            e.yCoord,
            e.npc.id,
            e.npc.roomId,
            e.npc.hitpoints,
            verzikNpcColor(e.npc.id),
          ),
        );
        break;
      }
    }
  }

  const playerDetails = getPlayerDetails(
    raidData.party,
    eventsForCurrentTick.filter(isPlayerEvent) as PlayerEvent[],
  );

  return (
    <>
      <div className={styles.bossPage__Overview}>
        <div className={styles.bossPage__BossPic}>
          <Image
            src="/verzik.webp"
            alt="Verzik Vitur"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={styles.bossPage__KeyDetails}>
          <h2>Verzik Vitur ({ticksToFormattedSeconds(totalTicks)})</h2>
        </div>
      </div>

      <BossPageControls
        currentlyPlaying={playing}
        totalTicks={totalTicks}
        currentTick={currentTick}
        updateTick={updateTickOnPage}
        updatePlayingState={setPlaying}
        splits={splits}
      />

      <BossPageAttackTimeline
        currentTick={currentTick}
        playing={playing}
        playerAttackTimelines={playerAttackTimelines}
        bossAttackTimeline={bossAttackTimeline}
        timelineTicks={totalTicks}
        updateTickOnPage={updateTickOnPage}
        npcs={verzikData?.npcs ?? {}}
        splits={splits}
        backgroundColors={backgroundColors}
      />

      <BossPageReplay
        entities={entities}
        mapDef={VERZIK_MAP_DEFINITION}
        playerDetails={playerDetails}
      />
    </>
  );
}
