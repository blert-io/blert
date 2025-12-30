'use client';

import {
  BloatDownEvent,
  BloatHandsDropEvent,
  BloatHandsSplatEvent,
  ChallengeStatus,
  Coords,
  EventType,
  Npc,
  NpcEvent,
  SkillLevel,
  Stage,
  TobRaid,
} from '@blert/common';

import Image from 'next/image';
import { useCallback, useContext, useMemo, useState } from 'react';

import { TimelineColor } from '@/components/attack-timeline';
import BossFightOverview from '@/components/boss-fight-overview';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import BossPageControls from '@/components/boss-page-controls';
import BossPageDPSTimeline from '@/components/boss-page-dps-timeline';
import BossPageParty from '@/components/boss-page-party';
import BossPageReplay, {
  NewBossPageReplay,
} from '@/components/boss-page-replay';
import Card from '@/components/card';
import {
  Entity as LegacyEntity,
  MarkerEntity as LegacyMarkerEntity,
  NpcEntity as LegacyNpcEntity,
  OverlayEntity as LegacyOverlayEntity,
  PlayerEntity as LegacyPlayerEntity,
} from '@/components/map';
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
  useLegacyTickTimeout,
  useMapEntities,
  usePlayingState,
  useStageEvents,
} from '@/utils/boss-room-state';
import { inRect } from '@/utils/coords';
import { ticksToFormattedSeconds } from '@/utils/tick';

import BarrierEntity from '../barrier';
import BloatHandRenderer, { BloatHandData, BloatHandState } from './bloat-hand';

import bloatBaseTiles from './bloat-tiles.json';
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

const LEGACY_BLOAT_MAP_DEFINITION = {
  baseX: 3288,
  baseY: 4440,
  width: 16,
  height: 16,
  baseTiles: bloatBaseTiles,
};

const BLOAT_PILLAR_OUTLINE = new LegacyMarkerEntity(3293, 4445, 'white', 6);

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

const DEFAULT_USE_NEW_REPLAY = true;

export default function BloatPage() {
  const display = useDisplay();
  const [useNewReplay, setUseNewReplay] = useState(DEFAULT_USE_NEW_REPLAY);

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
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    loading,
  } = useStageEvents<TobRaid>(Stage.TOB_BLOAT);

  const { currentTick, setTick, playing, setPlaying, advanceTick } =
    usePlayingState(totalTicks);
  const { updateTickOnPage } = useLegacyTickTimeout(
    !useNewReplay,
    playing,
    currentTick,
    setTick,
  );

  const { setSelectedPlayer, selectedPlayer } = useContext(ActorContext);

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
  }, [eventsByType, npcState, totalTicks]);

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

    const unmatchedDropTicks = new Set<number>();
    eventsByType[EventType.TOB_BLOAT_HANDS_DROP]?.forEach((evt) => {
      unmatchedDropTicks.add(evt.tick);
    });

    const drops = (eventsByType[EventType.TOB_BLOAT_HANDS_DROP] ??
      []) as BloatHandsDropEvent[];
    const splats = (eventsByType[EventType.TOB_BLOAT_HANDS_SPLAT] ??
      []) as BloatHandsSplatEvent[];

    for (const splat of splats) {
      const splatTick = splat.tick;
      const correspondingDrop = drops.findLast(
        (drop) =>
          drop.tick < splatTick &&
          drop.tick >= splatTick - BLOAT_HAND_DROP_TICKS,
      );
      if (correspondingDrop !== undefined) {
        unmatchedDropTicks.delete(correspondingDrop.tick);

        for (let tick = correspondingDrop.tick; tick <= splatTick; tick++) {
          handsByTick.set(tick, {
            dropTick: correspondingDrop.tick,
            intensity: BLOAT_HAND_DROP_TICKS - (splatTick - tick),
            hands: splat.bloatHands,
          });
        }
      }
    }

    if (unmatchedDropTicks.size > 0) {
      console.warn(`${unmatchedDropTicks.size} unmatched hand drops.`);
    }

    return handsByTick;
  }, [eventsByType]);

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

  const { entitiesByTick, preloads } = useMapEntities(
    challenge,
    playerState,
    npcState,
    totalTicks,
    {
      customEntitiesForTick,
    },
  );

  if (loading || challenge === null) {
    return <Loading />;
  }

  const bloatData = challenge.tobRooms.bloat;
  if (challenge.status !== ChallengeStatus.IN_PROGRESS && bloatData === null) {
    return <>No Bloat data for this raid</>;
  }

  const eventsForCurrentTick = eventsByTick[currentTick] ?? [];

  const legacyEntities: LegacyEntity[] = [BLOAT_PILLAR_OUTLINE];
  const players: LegacyPlayerEntity[] = [];

  for (const evt of eventsForCurrentTick) {
    switch (evt.type) {
      case EventType.PLAYER_UPDATE: {
        const hitpoints = evt.player.hitpoints
          ? SkillLevel.fromRaw(evt.player.hitpoints)
          : undefined;
        const player = new LegacyPlayerEntity(
          evt.xCoord,
          evt.yCoord,
          evt.player.name,
          hitpoints,
        );
        legacyEntities.push(player);
        players.push(player);
        break;
      }
      case EventType.NPC_SPAWN:
      case EventType.NPC_UPDATE: {
        const e = evt as NpcEvent;
        const npc = new LegacyNpcEntity(
          e.xCoord,
          e.yCoord,
          e.npc.id,
          e.npc.roomId,
          SkillLevel.fromRaw(e.npc.hitpoints),
        );
        if (
          !legacyEntities.some(
            (entity) => entity.getUniqueId() === npc.getUniqueId(),
          )
        ) {
          legacyEntities.push(npc);
        }
        break;
      }
    }
  }

  const handsForCurrentTick = hands.get(currentTick);
  if (handsForCurrentTick !== undefined) {
    let image;
    if (handsForCurrentTick.intensity === 3) {
      image = (
        <Image
          src="/images/objects/bloat_hand_splat.png"
          alt="Bloat hand splat"
          width={24}
          height={24}
        />
      );
    } else {
      const sizes = [12, 18, 24];
      const size = sizes[handsForCurrentTick.intensity];
      image = (
        <Image
          src="/images/objects/bloat_hand_drop.png"
          alt="Bloat hand drop"
          width={size}
          height={size}
        />
      );
    }

    for (const hand of handsForCurrentTick.hands) {
      const entity = new LegacyOverlayEntity(
        hand.x,
        hand.y,
        'hand',
        <div className={styles.hand}>{image}</div>,
        /*interactable=*/ false,
        /*size=*/ 1,
        /*customZIndex=*/ 0,
      );
      legacyEntities.push(entity);
    }
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
                {ticksToFormattedSeconds(down.walkTime - 1)}
                <span className={styles.walkTicks}>({down.walkTime - 1})</span>
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
          updateTickOnPage={updateTickOnPage}
          npcs={npcState}
          splits={splits}
          backgroundColors={backgroundColors}
        />
      </div>

      <div className={bossStyles.replayAndParty}>
        <div className={bossStyles.replay}>
          {useNewReplay ? (
            <NewBossPageReplay
              entities={entitiesByTick.get(currentTick) ?? []}
              preloads={preloads}
              mapDef={mapDefinition}
              playing={playing}
              width={display.isCompact() ? 352 : 550}
              height={display.isCompact() ? 352 : 550}
              currentTick={currentTick}
              advanceTick={advanceTick}
              setUseLegacy={() => setUseNewReplay(false)}
            />
          ) : (
            <BossPageReplay
              entities={legacyEntities}
              mapDef={LEGACY_BLOAT_MAP_DEFINITION}
              tileSize={display.isCompact() ? 22 : undefined}
            />
          )}
        </div>
        <div className={bossStyles.party}>
          <BossPageParty
            playerTickState={playerTickState}
            selectedPlayer={selectedPlayer}
            setSelectedPlayer={setSelectedPlayer}
          />
        </div>
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
          />
        </Card>
      </div>

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
