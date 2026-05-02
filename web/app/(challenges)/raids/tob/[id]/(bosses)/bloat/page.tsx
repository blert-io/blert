'use client';

import {
  BloatDownEvent,
  BloatHandsDropEvent,
  BloatHandsSplatEvent,
  Coords,
  EventType,
  Npc,
  SkillLevel,
  Stage,
  TobRaid,
} from '@blert/common';

import { useCallback, useContext, useMemo } from 'react';

import { TimelineColor } from '@/components/attack-timeline';
import BossFightOverview from '@/components/boss-fight-overview';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import BossPageControls from '@/components/boss-page-controls';
import BossPageDPSTimeline from '@/components/boss-page-dps-timeline';
import BossPageParty from '@/components/boss-page-party';
import BossPageReplay from '@/components/boss-page-replay';
import Card from '@/components/card';
import {
  CustomEntity,
  MapDefinition,
  Terrain,
} from '@/components/map-renderer';
import Loading from '@/components/loading';
import { useDisplay } from '@/display';
import { ActorContext } from '@/(challenges)/raids/tob/context';
import {
  EnhancedRoomNpc,
  useMapEntities,
  usePreloads,
  usePlayingState,
  useStableEvents,
  useStageEvents,
} from '@/utils/boss-room-state';
import { inRect } from '@/utils/coords';
import { ticksToFormattedSeconds } from '@/utils/tick';

import BarrierEntity from '../barrier';
import BloatHandRenderer, { BloatHandData, BloatHandState } from './bloat-hand';
import MissingStageData from '../missing-stage-data';

import bossStyles from '../style.module.scss';
import styles from './style.module.scss';

class BloatTerrain implements Terrain {
  isPassable(coords: Coords): boolean {
    // Central tank area.
    return !inRect(coords, { x: 3293, y: 4445, width: 6, height: 6 });
  }
}

const BLOAT_MAP_DEFINITION: MapDefinition = {
  baseX: 3280,
  baseY: 4432,
  width: 32,
  height: 32,
  terrain: new BloatTerrain(),
};

const BARRIERS = [
  new BarrierEntity({ x: 3305, y: 4448 }, 4, Math.PI / 2),
  new BarrierEntity({ x: 3287, y: 4448 }, 4, (3 * Math.PI) / 2),
];

type DownInfo = {
  tick: number;
  walkTime: number;
  startHitpoints: SkillLevel | undefined;
  endHitpoints: SkillLevel | undefined;
};

type TickHands = {
  dropTick: number;
  intensity: number;
  hands: Coords[];
};
const BLOAT_HAND_DROP_TICKS = 3;

export default function BloatPage() {
  const display = useDisplay();

  const compact = display.isCompact();

  const mapDefinition = useMemo(() => {
    const initialZoom = compact ? 18 : 29;
    return {
      ...BLOAT_MAP_DEFINITION,
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
  } = useStageEvents<TobRaid>(Stage.TOB_BLOAT);

  const {
    currentTick,
    advanceTick,
    setTick,
    playing,
    setPlaying,
    following,
    jumpToLive,
  } = usePlayingState(totalTicks, isStreaming);

  const { setSelectedActor, selectedActor } = useContext(ActorContext);

  const bloatDownEvents = useStableEvents<BloatDownEvent>(
    eventsByType,
    EventType.TOB_BLOAT_DOWN,
  );
  const bloatUpEvents = useStableEvents(eventsByType, EventType.TOB_BLOAT_UP);
  const handsDropEvents = useStableEvents<BloatHandsDropEvent>(
    eventsByType,
    EventType.TOB_BLOAT_HANDS_DROP,
  );
  const handsSplatEvents = useStableEvents<BloatHandsSplatEvent>(
    eventsByType,
    EventType.TOB_BLOAT_HANDS_SPLAT,
  );

  const { downInfo, splits, backgroundColors } = useMemo(() => {
    const bloat: EnhancedRoomNpc | null =
      npcState.values().next().value ?? null;

    const downInfo: DownInfo[] = bloatDownEvents.map((evt) => ({
      tick: evt.tick,
      walkTime: evt.bloatDown.walkTime,
      startHitpoints: bloat?.stateByTick[evt.tick]?.hitpoints,
      endHitpoints: undefined,
    }));

    const splits = downInfo.map((down, i) => ({
      tick: down.tick,
      splitName: `Down ${i + 1}`,
    }));

    const upColor = 'rgba(100, 56, 70, 0.3)';
    const backgroundColors: TimelineColor[] = [];

    // First up from the start of the room.
    backgroundColors.push({
      tick: 0,
      length: downInfo.length > 0 ? downInfo[0].tick : totalTicks,
      backgroundColor: upColor,
    });

    bloatUpEvents.forEach((evt, i) => {
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
  }, [bloatDownEvents, bloatUpEvents, npcState, totalTicks]);

  const bossHealthChartData = useMemo(() => {
    let bloat: EnhancedRoomNpc | null = null;
    const iter = npcState.values();
    for (let npc = iter.next(); !npc.done; npc = iter.next()) {
      if (Npc.isBloat(npc.value.spawnNpcId)) {
        bloat = npcState.get(npc.value.roomId)!;
        break;
      }
    }

    return (
      bloat?.stateByTick.map((state, tick) => ({
        tick,
        bossHealthPercentage: state?.hitpoints.percentage() ?? 0,
      })) ?? []
    );
  }, [npcState]);

  const hands = useMemo(() => {
    const handsByTick = new Map<number, TickHands>();

    const matchedDropTicks = new Set<number>();

    for (const splat of handsSplatEvents) {
      const splatTick = splat.tick;
      const correspondingDrop = handsDropEvents.findLast(
        (drop) =>
          drop.tick < splatTick &&
          drop.tick >= splatTick - BLOAT_HAND_DROP_TICKS,
      );
      if (correspondingDrop !== undefined) {
        matchedDropTicks.add(correspondingDrop.tick);

        for (let tick = correspondingDrop.tick; tick <= splatTick; tick++) {
          handsByTick.set(tick, {
            dropTick: correspondingDrop.tick,
            intensity: BLOAT_HAND_DROP_TICKS - (splatTick - tick),
            hands: splat.bloatHands,
          });
        }
      }
    }

    let unmatchedCount = 0;
    for (const drop of handsDropEvents) {
      if (matchedDropTicks.has(drop.tick)) {
        continue;
      }
      if (!isLive) {
        unmatchedCount++;
        continue;
      }
      // During live, the splat event hasn't arrived yet for recent drops.
      // Render using the drop event's coordinates with an assumed splat timing.
      const assumedSplatTick = drop.tick + BLOAT_HAND_DROP_TICKS;
      for (let tick = drop.tick; tick <= assumedSplatTick; tick++) {
        handsByTick.set(tick, {
          dropTick: drop.tick,
          intensity: BLOAT_HAND_DROP_TICKS - (assumedSplatTick - tick),
          hands: drop.bloatHands,
        });
      }
    }

    if (unmatchedCount > 0) {
      console.warn(`${unmatchedCount} unmatched hand drops.`);
    }

    return handsByTick;
  }, [handsDropEvents, handsSplatEvents, isLive]);

  const customEntitiesForTick = useCallback(
    (tick: number): CustomEntity[] => {
      const entities: CustomEntity[] = [...BARRIERS];

      const handsForTick = hands.get(tick);
      if (handsForTick === undefined) {
        return entities;
      }

      const state =
        handsForTick.intensity === BLOAT_HAND_DROP_TICKS
          ? BloatHandState.SPLAT
          : BloatHandState.FALLING;

      entities.push(
        ...handsForTick.hands.map(
          (hand) =>
            new CustomEntity<BloatHandData>(
              { x: hand.x, y: hand.y },
              'Bloat hand',
              1,
              BloatHandRenderer,
              {
                state,
                dropProgress: handsForTick.intensity / BLOAT_HAND_DROP_TICKS,
                dropTicks: BLOAT_HAND_DROP_TICKS,
              },
              `bloat-hand-${handsForTick.dropTick}-${hand.x}-${hand.y}`,
            ),
        ),
      );

      return entities;
    },
    [hands],
  );

  const getEntities = useMapEntities(
    challenge,
    playerState,
    npcState,
    totalTicks,
    {
      customEntitiesForTick,
    },
  );
  const preloads = usePreloads(npcState, isLive);

  if (loading || challenge === null) {
    return <Loading />;
  }

  const bloatData = challenge.tobRooms.bloat;
  if (!isLive && bloatData === null) {
    return <MissingStageData stage={Stage.TOB_BLOAT} />;
  }

  const playerTickState = challenge.party.reduce(
    (acc, { username }) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  const downStats = downInfo.map((down, i) => ({
    title: `Down ${i + 1}`,
    content: (
      <div key={i} className={styles.down}>
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
              <td className={styles.walkTime}>
                {ticksToFormattedSeconds(down.walkTime)}
                <span className={styles.walkTicks}>({down.walkTime})</span>
              </td>
            </tr>
            <tr>
              <td>
                <i className="fa-solid fa-heart" style={{ paddingRight: 10 }} />
                <span className="sr-only">Start hitpoints</span>
              </td>
              <td>
                {down.startHitpoints
                  ? down.startHitpoints.toPercent(1)
                  : 'Unknown'}
                <span className={styles.arrow}>{' -> '}</span>
                {down.endHitpoints ? down.endHitpoints.toPercent(1) : 'Unknown'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
  }));

  return (
    <>
      <div className={bossStyles.overview}>
        <BossFightOverview
          name="The Pestilent Bloat"
          image="/bloat.webp"
          time={totalTicks}
          sections={downStats}
        />
      </div>

      <div className={bossStyles.timeline}>
        <BossPageAttackTimeline
          currentTick={currentTick}
          playing={playing}
          playerState={playerState}
          timelineTicks={totalTicks}
          updateTickOnPage={setTick}
          npcs={npcState}
          bcf={bcf}
          splits={splits}
          backgroundColors={backgroundColors}
          liveFollowing={following}
        />
      </div>

      <div className={bossStyles.replayAndParty}>
        <BossPageReplay
          entities={getEntities(currentTick)}
          preloads={preloads}
          mapDef={mapDefinition}
          playing={playing}
          width={display.isCompact() ? 352 : 550}
          height={display.isCompact() ? 352 : 550}
          currentTick={currentTick}
          advanceTick={advanceTick}
        />
        <BossPageParty
          playerTickState={playerTickState}
          selectedActor={selectedActor}
          setSelectedActor={setSelectedActor}
        />
      </div>

      <div className={bossStyles.charts}>
        <Card
          className={bossStyles.chart}
          header={{ title: "Bloat's Health By Tick" }}
        >
          <BossPageDPSTimeline
            currentTick={currentTick}
            data={bossHealthChartData}
            width="100%"
            height="100%"
            animate={!isLive}
          />
        </Card>
      </div>

      <BossPageControls
        currentlyPlaying={playing}
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
