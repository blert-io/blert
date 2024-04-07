'use client';

import {
  ChallengeStatus,
  EventType,
  NpcEvent,
  PlayerUpdateEvent,
  SkillLevel,
  Stage,
} from '@blert/common';
import Image from 'next/image';
import { useMemo } from 'react';

import {
  usePlayingState,
  useRoomEvents,
} from '../../../../../utils/boss-room-state';
import { RaidContext } from '../../../context';
import { BossPageControls } from '../../../../../components/boss-page-controls/boss-page-controls';
import {
  BossPageAttackTimeline,
  TimelineColor,
} from '../../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import BossPageReplay from '../../../../../components/boss-page-replay';
import {
  Entity,
  MarkerEntity,
  NpcEntity,
  PlayerEntity,
} from '../../../../../components/map';
import Loading from '../../../../../components/loading';
import { ticksToFormattedSeconds } from '../../../../../utils/tick';

import bloatBaseTiles from './bloat-tiles.json';
import styles from './style.module.scss';

const BLOAT_MAP_DEFINITION = {
  baseX: 3288,
  baseY: 4440,
  width: 16,
  height: 16,
  baseTiles: bloatBaseTiles,
};

const BLOAT_PILLAR_OUTLINE = new MarkerEntity(3293, 4445, 'white', 6);

export default function BloatPage() {
  const {
    challenge: raidData,
    totalTicks,
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    loading,
  } = useRoomEvents(RaidContext, Stage.TOB_BLOAT);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const [splits, backgroundColors] = useMemo(() => {
    const downTicks =
      eventsByType[EventType.TOB_BLOAT_DOWN]?.map((evt) => evt.tick) ?? [];

    let splits = downTicks.map((tick, i) => ({
      tick,
      splitName: `Down ${i + 1}`,
    }));

    const upColor = 'rgba(100, 56, 70, 0.3)';
    let backgroundColors: TimelineColor[] = [];

    // First up from the start of the room.
    backgroundColors.push({
      tick: 0,
      length: downTicks.length > 0 ? downTicks[0] : totalTicks,
      backgroundColor: upColor,
    });

    eventsByType[EventType.TOB_BLOAT_UP]?.forEach((evt) => {
      splits.push({ tick: evt.tick, splitName: 'Moving' });

      const nextDownTick =
        downTicks.find((tick) => tick > evt.tick) ?? totalTicks;
      backgroundColors.push({
        tick: evt.tick,
        length: nextDownTick - evt.tick,
        backgroundColor: upColor,
      });
    });

    return [splits, backgroundColors];
  }, [eventsByType]);

  if (loading || raidData === null) {
    return <Loading />;
  }

  const bloatData = raidData.tobRooms.bloat;
  if (raidData.status !== ChallengeStatus.IN_PROGRESS && bloatData === null) {
    return <>No Bloat data for this raid</>;
  }

  const eventsForCurrentTick = eventsByTick[currentTick] ?? [];

  const entities: Entity[] = [BLOAT_PILLAR_OUTLINE];
  const players: PlayerEntity[] = [];

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
            SkillLevel.fromRaw(e.npc.hitpoints),
          ),
        );
        break;
      }
    }
  }

  const playerTickState = raidData.party.reduce(
    (acc, username) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  return (
    <>
      <div className={styles.bossPage__Overview}>
        <div className={styles.bossPage__BossPic}>
          <Image
            src="/bloat.webp"
            alt="The Pestilent Bloat"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={styles.bossPage__KeyDetails}>
          <h2>The Pestilent Bloat ({ticksToFormattedSeconds(totalTicks)})</h2>
        </div>
      </div>

      <BossPageAttackTimeline
        currentTick={currentTick}
        playing={playing}
        playerState={playerState}
        timelineTicks={totalTicks}
        updateTickOnPage={updateTickOnPage}
        npcs={npcState}
        splits={splits}
        backgroundColors={backgroundColors}
      />

      <BossPageReplay
        entities={entities}
        mapDef={BLOAT_MAP_DEFINITION}
        playerTickState={playerTickState}
      />

      <BossPageControls
        currentlyPlaying={playing}
        totalTicks={totalTicks}
        currentTick={currentTick}
        updateTick={updateTickOnPage}
        updatePlayingState={setPlaying}
        splits={splits}
      />
    </>
  );
}
