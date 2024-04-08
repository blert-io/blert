'use client';

import {
  BloatDownEvent,
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
  EnhancedRoomNpc,
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

type DownInfo = {
  tick: number;
  walkTime: number;
  startHitpoints: SkillLevel | undefined;
  endHitpoints: SkillLevel | undefined;
};

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

  const { downInfo, splits, backgroundColors } = useMemo(() => {
    const bloat: EnhancedRoomNpc | null =
      npcState.values().next().value ?? null;

    const downInfo: DownInfo[] =
      eventsByType[EventType.TOB_BLOAT_DOWN]?.map((evt) => {
        const bloatDownEvent = evt as BloatDownEvent;
        return {
          tick: evt.tick,
          walkTime: bloatDownEvent.bloatDown.walkTime,
          startHitpoints: bloat?.stateByTick[evt.tick]?.hitpoints,
          endHitpoints: undefined,
        };
      }) ?? [];

    let splits = downInfo.map((down, i) => ({
      tick: down.tick,
      splitName: `Down ${i + 1}`,
    }));

    const upColor = 'rgba(100, 56, 70, 0.3)';
    let backgroundColors: TimelineColor[] = [];

    // First up from the start of the room.
    backgroundColors.push({
      tick: 0,
      length: downInfo.length > 0 ? downInfo[0].tick : totalTicks,
      backgroundColor: upColor,
    });

    eventsByType[EventType.TOB_BLOAT_UP]?.forEach((evt, i) => {
      splits.push({ tick: evt.tick, splitName: 'Moving' });

      const nextDownTick =
        downInfo.find((down) => down.tick > evt.tick)?.tick ?? totalTicks;
      backgroundColors.push({
        tick: evt.tick,
        length: nextDownTick - evt.tick,
        backgroundColor: upColor,
      });

      downInfo[i].endHitpoints = bloat?.stateByTick[evt.tick]?.hitpoints;
    });

    if (downInfo.length > 0) {
      downInfo[downInfo.length - 1].endHitpoints =
        bloat?.stateByTick[totalTicks - 1]?.hitpoints;
    }

    return { downInfo, splits, backgroundColors };
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
          <div className={styles.downs}>
            {downInfo.map((down, i) => (
              <div key={i} className={styles.down}>
                <h3>Down {i + 1}</h3>
                <table>
                  <tbody>
                    <tr>
                      <td>
                        <i
                          className="fa-solid fa-person-walking"
                          style={{ padding: '0 7px 0 3px' }}
                        />
                        <span className="sr-only">Walk time</span>
                      </td>
                      <td>{ticksToFormattedSeconds(down.walkTime)}</td>
                    </tr>
                    <tr>
                      <td>
                        <i
                          className="fa-solid fa-heart"
                          style={{ paddingRight: 10 }}
                        />
                        <span className="sr-only">Start hitpoints</span>
                      </td>
                      <td>
                        {down.startHitpoints
                          ? down.startHitpoints.toPercent(1)
                          : 'Unknown'}
                        {' -> '}
                        {down.endHitpoints
                          ? down.endHitpoints.toPercent(1)
                          : 'Unknown'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
          </div>
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
