'use client';

import Image from 'next/image';
import {
  EventType,
  MaidenBloodSplatsEvent,
  Npc,
  NpcEvent,
  PlayerEvent,
  PlayerUpdateEvent,
  RaidStatus,
  Room,
  isPlayerEvent,
} from '@blert/common';
import { TimelineSplit } from '../../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import { useContext, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { MAIDEN } from '../../../../../bosses/tob';
import { BossPageAttackTimeline } from '../../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import { BossPageControls } from '../../../../../components/boss-page-controls/boss-page-controls';
import BossPageReplay from '../../../../../components/boss-page-replay';
import { BossPageDPSTimeline } from '../../../../../components/boss-page-dps-timeine/boss-page-dps-timeline';
import {
  Entity,
  MarkerEntity,
  NpcEntity,
  PlayerEntity,
} from '../../../../../components/map';
import {
  getPlayerDetails,
  usePlayingState,
  useRoomEvents,
} from '../../../boss-room-state';
import { clamp } from '../../../../../utils/math';
import { ActorContext } from '../../../context';

import maidenBaseTiles from './maiden.json';
import styles from './style.module.scss';

const MAIDEN_MAP_DEFINITION = {
  baseX: 3160,
  baseY: 4435,
  width: 28,
  height: 24,
  baseTiles: maidenBaseTiles,
};
const BLOOD_SPLAT_COLOR = '#b93e3e';

export default function Maiden() {
  const searchParams = useSearchParams();

  const {
    raidData,
    events,
    totalTicks,
    eventsByTick,
    eventsByType,
    bossAttackTimeline,
    playerAttackTimelines,
  } = useRoomEvents(Room.MAIDEN);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const tickParam = searchParams.get('tick');
  let parsedTickParam = 0;
  if (tickParam === null) {
    parsedTickParam = 1;
  } else {
    parsedTickParam = Number.parseInt(tickParam, 10);
    if (Number.isNaN(parsedTickParam)) {
      console.log('Unable to parse param as valid int, defaulting to 1');
      parsedTickParam = 1;
    }
  }

  const finalParsedTickParam = clamp(Math.abs(parsedTickParam), 1, totalTicks);

  useEffect(() => {
    updateTickOnPage(finalParsedTickParam);
  }, [finalParsedTickParam, updateTickOnPage]);

  const bossHealthChartData = useMemo(() => {
    return (
      eventsByType[EventType.NPC_UPDATE]
        ?.filter((evt) => Npc.isMaiden((evt as NpcEvent).npc.id))
        .map((evt) => {
          const e = evt as NpcEvent;
          return {
            tick: e.tick,
            bossHealthPercentage:
              (e.npc.hitpoints.current / e.npc.hitpoints.base) * 100,
          };
        }) ?? []
    );
  }, [events]);

  const { selectedPlayer } = useContext(ActorContext);

  if (raidData === null || events.length === 0) {
    return <>Loading...</>;
  }

  const maidenData = raidData.rooms[Room.MAIDEN];
  if (raidData.status !== RaidStatus.IN_PROGRESS && maidenData === null) {
    return <>No Maiden data for raid</>;
  }

  const eventsForCurrentTick = eventsByTick[currentTick] ?? [];

  const entities: Entity[] = [];
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
          /*highlight=*/ e.player.name === selectedPlayer,
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
          ),
        );
        break;
      }
      case EventType.MAIDEN_BLOOD_SPLATS:
        const e = evt as MaidenBloodSplatsEvent;
        for (const coord of e.maidenBloodSplats ?? []) {
          entities.push(new MarkerEntity(coord.x, coord.y, BLOOD_SPLAT_COLOR));
        }
        break;
    }
  }

  const splits: TimelineSplit[] = [];

  if (maidenData !== null) {
    if (maidenData.splits.SEVENTIES) {
      splits.push({
        tick: maidenData.splits.SEVENTIES,
        splitName: '70s',
      });
    }

    if (maidenData.splits.FIFTIES) {
      splits.push({
        tick: maidenData.splits.FIFTIES,
        splitName: '50s',
      });
    }

    if (maidenData.splits.THIRTIES) {
      splits.push({
        tick: maidenData.splits.THIRTIES,
        splitName: '30s',
      });
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
            src="/maiden.webp"
            alt="The Maiden of Sugadinti"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={styles.bossPage__KeyDetails}>
          <h2>The Maiden of Sugondeez</h2>
        </div>
      </div>

      <BossPageControls
        currentlyPlaying={playing}
        totalTicks={totalTicks}
        currentTick={currentTick}
        updateTick={updateTickOnPage}
        updatePlayingState={setPlaying}
      />

      <BossPageAttackTimeline
        currentTick={currentTick}
        playing={playing}
        playerAttackTimelines={playerAttackTimelines}
        bossAttackTimeline={bossAttackTimeline}
        timelineTicks={totalTicks}
        updateTickOnPage={updateTickOnPage}
        splits={splits}
        npcs={maidenData?.npcs ?? {}}
      />

      <BossPageReplay
        entities={entities}
        mapDef={MAIDEN_MAP_DEFINITION}
        playerDetails={playerDetails}
      />

      <BossPageDPSTimeline
        currentTick={currentTick}
        data={bossHealthChartData}
      />
    </>
  );
}
