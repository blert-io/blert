'use client';

import {
  ChallengeMode,
  Coords,
  EventType,
  Npc,
  NpcAttack,
  NpcAttackEvent,
  SplitType,
  Stage,
  TobRaid,
  XarpusExhumedEvent,
  XarpusExhumesEvent,
  XarpusHealEvent,
  XarpusSplatEvent,
  XarpusSplatSource,
} from '@blert/common';
import { useCallback, useContext, useMemo } from 'react';

import { TimelineSplit } from '@/components/attack-timeline';
import BossFightOverview from '@/components/boss-fight-overview';
import BossPageAttackTimeline, {
  CustomStateEntry,
  useBossPageTimeline,
} from '@/components/boss-page-attack-timeline';
import BossPageControls from '@/components/boss-page-controls';
import BossPageDPSTimeline from '@/components/boss-page-dps-timeline';
import BossPageParty from '@/components/boss-page-party';
import BossPageReplay from '@/components/boss-page-replay';
import Card from '@/components/card';
import {
  AnyEntity,
  EntityType,
  MapDefinition,
  NpcEntity,
  SpriteSheet,
} from '@/components/map-renderer';
import Loading from '@/components/loading';
import MissingStageData from '@/components/missing-stage-data';
import { DisplayContext } from '@/display';
import { ActorContext } from '@/(challenges)/raids/tob/context';
import {
  EnhancedRoomNpc,
  useMapEntities,
  usePreloads,
  usePlayingState,
  useStableEvents,
  useStageEvents,
} from '@/utils/boss-room-state';
import { ticksToFormattedSeconds } from '@/utils/tick';

import BarrierEntity from '../barrier';
import {
  ACID_BALL,
  ACID_POOL,
  ACID_SPLASH,
  AcidBallEntity,
  AcidPoolEntity,
  AcidSplashEntity,
  DangerQuadrantEntity,
  ExhumedEntity,
  PoisonBallEntity,
  ExhumedState,
} from './entities';

import bossStyles from '../style.module.scss';
import styles from './style.module.scss';

const XARPUS_MAP_DEFINITION: MapDefinition = {
  baseX: 3154,
  baseY: 4372,
  width: 32,
  height: 32,
  plane: 1,
};

const MAP_CENTER = { x: 3170, y: 4387 };
const BARRIERS = [
  new BarrierEntity({ x: 3170, y: 4380 }, 3),
  new BarrierEntity({ x: 3170, y: 4395 }, 3, Math.PI),
];

const XARPUS_FACINGS: SpriteSheet = {
  url: '/images/objects/xarpus-facings.webp',
  columns: 4,
  rows: 4,
  cellWidth: 5.2422,
  cellHeight: 3.5859,
  anchorX: 0.5007,
  anchorY: 0.9804,
};

const XARPUS_P1_FACINGS: SpriteSheet = {
  url: '/images/objects/xarpus-p1-facings.webp',
  columns: 4,
  rows: 4,
  cellWidth: 2.875,
  cellHeight: 2.2188,
  anchorX: 0.5027,
  anchorY: 0.8556,
};

const MAX_ORIENTATION = 2048;

const TURN_ORIENTATIONS = new Map<NpcAttack, number>([
  [NpcAttack.TOB_XARPUS_TURN_NORTHEAST, 1280],
  [NpcAttack.TOB_XARPUS_TURN_SOUTHEAST, 1792],
  [NpcAttack.TOB_XARPUS_TURN_SOUTHWEST, 256],
  [NpcAttack.TOB_XARPUS_TURN_NORTHWEST, 768],
]);

const TURN_PER_TICK = 32 * 30;

const XARPUS_MID_HEIGHT =
  (XARPUS_FACINGS.anchorY * XARPUS_FACINGS.cellHeight) / 2;

const DANGER_QUADRANT_CORNERS = new Map<NpcAttack, Coords>([
  [NpcAttack.TOB_XARPUS_TURN_NORTHEAST, { x: 3177, y: 4394 }],
  [NpcAttack.TOB_XARPUS_TURN_SOUTHEAST, { x: 3177, y: 4380 }],
  [NpcAttack.TOB_XARPUS_TURN_SOUTHWEST, { x: 3163, y: 4380 }],
  [NpcAttack.TOB_XARPUS_TURN_NORTHWEST, { x: 3163, y: 4394 }],
]);

function turnToward(from: number, to: number, amount: number): number {
  const half = MAX_ORIENTATION / 2;
  const delta =
    ((((to - from + half) % MAX_ORIENTATION) + MAX_ORIENTATION) %
      MAX_ORIENTATION) -
    half;
  const turned = from + Math.sign(delta) * Math.min(Math.abs(delta), amount);
  return ((turned % MAX_ORIENTATION) + MAX_ORIENTATION) % MAX_ORIENTATION;
}

type Exhumed = {
  position: Coords;
  spawnTick: number;
  despawnTick: number | null;
  healTicks: number[];
};

export default function XarpusPage() {
  const display = useContext(DisplayContext);

  const compact = display.isCompact();

  const mapDefinition = useMemo(() => {
    const initialZoom = compact ? 19 : 28;
    return {
      ...XARPUS_MAP_DEFINITION,
      initialZoom,
    };
  }, [compact]);

  const {
    challenge,
    totalTicks,
    eventsByType,
    playerState,
    npcState,
    bcf,
    loading,
    isLive,
    isStreaming,
  } = useStageEvents<TobRaid>(Stage.TOB_XARPUS);

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

  const splits = useMemo(() => {
    if (challenge === null) {
      return [];
    }

    const splits: TimelineSplit[] = [];
    if (challenge.splits[SplitType.TOB_XARPUS_EXHUMES]) {
      splits.push({
        tick: challenge.splits[SplitType.TOB_XARPUS_EXHUMES],
        splitName: 'Start',
      });
    }
    if (challenge.splits[SplitType.TOB_XARPUS_SCREECH]) {
      splits.push({
        tick: challenge.splits[SplitType.TOB_XARPUS_SCREECH],
        splitName: 'Screech',
      });
    }
    return splits;
  }, [challenge]);

  const xarpus = useMemo((): EnhancedRoomNpc | null => {
    const iter = npcState.values();
    for (let npc = iter.next(); !npc.done; npc = iter.next()) {
      if (Npc.isXarpus(npc.value.spawnNpcId)) {
        return npc.value;
      }
    }
    return null;
  }, [npcState]);

  const bossHealthChartData = useMemo(
    () =>
      xarpus?.stateByTick.map((state, tick) => ({
        tick,
        bossHealthPercentage: state?.hitpoints.percentage() ?? 0,
      })) ?? [],
    [xarpus],
  );

  const splatEvents = useStableEvents<XarpusSplatEvent>(
    eventsByType,
    EventType.TOB_XARPUS_SPLAT,
  );
  const exhumedEvents = useStableEvents<XarpusExhumedEvent>(
    eventsByType,
    EventType.TOB_XARPUS_EXHUMED,
  );
  const exhumesEvents = useStableEvents<XarpusExhumesEvent>(
    eventsByType,
    EventType.TOB_XARPUS_EXHUMES,
  );
  const healEvents = useStableEvents<XarpusHealEvent>(
    eventsByType,
    EventType.TOB_XARPUS_HEAL,
  );

  const isLegacy =
    exhumedEvents.length > 0 ||
    (eventsByType[EventType.NPC_ATTACK] ?? []).find(
      (e) =>
        (e as NpcAttackEvent).npcAttack.attack === NpcAttack.TOB_XARPUS_TURN,
    );

  const exhumes = useMemo((): Exhumed[] => {
    if (exhumedEvents.length > 0) {
      return exhumedEvents.map((evt) => ({
        position: { x: evt.xCoord, y: evt.yCoord },
        spawnTick: evt.xarpusExhumed.spawnTick,
        despawnTick: evt.tick,
        healTicks: evt.xarpusExhumed.healTicks,
      }));
    }

    const byId = new Map<number, Exhumed>();
    for (const evt of exhumesEvents) {
      for (const id of evt.xarpusExhumes.despawned) {
        const exhumed = byId.get(id);
        if (exhumed !== undefined) {
          exhumed.despawnTick = evt.tick;
        }
      }
      for (const { id, position } of evt.xarpusExhumes.spawned) {
        byId.set(id, {
          position,
          spawnTick: evt.tick,
          despawnTick: null,
          healTicks: [],
        });
      }
    }
    for (const evt of healEvents) {
      byId.get(evt.xarpusHeal.exhumed)?.healTicks.push(evt.tick);
    }
    return [...byId.values()];
  }, [exhumedEvents, exhumesEvents, healEvents]);

  const customStates = useMemo(() => {
    const entries: CustomStateEntry[] = [];
    if (xarpus === null) {
      return entries;
    }

    const healsByTick = new Map<number, number>();
    for (const exhumed of exhumes) {
      for (const tick of exhumed.healTicks) {
        healsByTick.set(tick, (healsByTick.get(tick) ?? 0) + 1);
      }
    }

    let totalHeals = 0;
    healsByTick.forEach((count) => {
      totalHeals += count;
    });

    const healAmount = challenge?.tobStats.xarpusHealing
      ? challenge.tobStats.xarpusHealing / totalHeals
      : null;

    healsByTick.forEach((count, tick) => {
      const healThisTick = healAmount !== null ? count * healAmount : null;
      entries.push({
        npcRoomId: xarpus.roomId,
        tick,
        states: [
          {
            iconUrl: '/images/combat/hitsplats/heal.png',
            label: healThisTick?.toString() ?? undefined,
            superimposeLabel: true,
            fullText: `Xarpus healed${healThisTick !== null ? ` for ${healThisTick.toString()} HP` : ''}`,
          },
        ],
      });
    });

    return entries;
  }, [challenge, xarpus, exhumes]);

  const dangerQuadrants = useMemo((): (Coords | null)[] => {
    if (xarpus === null) {
      return [];
    }

    let corner: Coords | null = null;
    return xarpus.stateByTick.map((state) => {
      if (state === null) {
        corner = null;
        return null;
      }

      const attack = state.attack?.attack;
      if (attack !== undefined) {
        corner = DANGER_QUADRANT_CORNERS.get(attack) ?? corner;
      }
      return corner;
    });
  }, [xarpus]);

  const pools = useMemo(() => {
    const firstSplats = new Map<string, XarpusSplatEvent>();
    for (const evt of splatEvents) {
      const tile = `${evt.xCoord},${evt.yCoord}`;
      if (!firstSplats.has(tile)) {
        firstSplats.set(tile, evt);
      }
    }
    return Array.from(firstSplats.values());
  }, [splatEvents]);

  const acidBalls = useMemo(() => {
    if (isLive || isLegacy) {
      return [];
    }

    return splatEvents.flatMap((evt, i) => {
      const { source, bounceFrom, startTick } = evt.xarpusSplat;
      if (startTick === null) {
        return [];
      }

      let from: Coords;
      let fromHeight: number;
      let launchTick: number;
      switch (source) {
        case XarpusSplatSource.XARPUS:
          from = MAP_CENTER;
          fromHeight = XARPUS_MID_HEIGHT;
          launchTick = startTick + 1;
          break;
        case XarpusSplatSource.BOUNCE:
          if (bounceFrom === null) {
            return [];
          }
          from = bounceFrom;
          fromHeight = 0;
          launchTick = startTick + 0.5;
          break;
        case XarpusSplatSource.UNKNOWN:
          return [];
        default: {
          const _exhaustive: never = source;
          return _exhaustive;
        }
      }

      if (launchTick >= evt.tick) {
        return [];
      }
      return [
        new AcidBallEntity(
          from,
          fromHeight,
          { x: evt.xCoord, y: evt.yCoord },
          launchTick,
          evt.tick,
          `acid-ball-${i}`,
        ),
      ];
    });
  }, [isLive, isLegacy, splatEvents]);

  const customEntitiesForTick = useCallback(
    (tick: number) => {
      const entities: AnyEntity[] = [...BARRIERS];

      const dangerQuadrant = dangerQuadrants[tick] ?? null;
      if (dangerQuadrant !== null) {
        entities.push(new DangerQuadrantEntity(MAP_CENTER, dangerQuadrant));
      }

      const despawnTick =
        xarpus !== null && xarpus.deathTick > 0 ? xarpus.deathTick : null;
      entities.push(
        ...pools
          .filter(
            (evt) =>
              evt.tick <= tick && (despawnTick === null || tick <= despawnTick),
          )
          .map(
            (evt) =>
              new AcidPoolEntity(
                { x: evt.xCoord, y: evt.yCoord },
                evt.tick,
                despawnTick,
              ),
          ),
      );

      splatEvents.forEach((evt, i) => {
        if (evt.tick === tick) {
          entities.push(
            new AcidSplashEntity(
              { x: evt.xCoord, y: evt.yCoord },
              evt.tick,
              `acid-splash-${i}`,
            ),
          );
        }
      });

      entities.push(
        ...acidBalls.filter(
          (ball) =>
            Math.floor(ball.data.launchTick) <= tick &&
            tick < ball.data.landingTick,
        ),
      );

      for (const exhumed of exhumes) {
        const { spawnTick, despawnTick } = exhumed;

        if (
          tick >= spawnTick &&
          (despawnTick === null || tick <= despawnTick)
        ) {
          let state: ExhumedState;

          if (tick === spawnTick) {
            state = ExhumedState.RISING;
          } else if (tick === despawnTick) {
            state = ExhumedState.RECEDING;
          } else {
            state = ExhumedState.ACTIVE;
          }

          const healCount = exhumed.healTicks.filter((t) => t <= tick).length;

          entities.push(new ExhumedEntity(exhumed.position, state, healCount));
        }
      }

      const balls = exhumes.flatMap((exhumed) => {
        return exhumed.healTicks
          .filter((t) => t === tick)
          .map((_) => new PoisonBallEntity(exhumed.position, MAP_CENTER));
      });

      entities.push(...balls);

      return entities;
    },
    [dangerQuadrants, xarpus, pools, splatEvents, acidBalls, exhumes],
  );

  const facings = useMemo((): ({ start: number; target: number } | null)[] => {
    if (xarpus === null || isLive || isLegacy) {
      return [];
    }

    const xarpusSplats = splatEvents.filter(
      (evt) => evt.xarpusSplat.source === XarpusSplatSource.XARPUS,
    );
    const hardModeScreech =
      challenge?.mode === ChallengeMode.TOB_HARD
        ? (challenge.splits[SplitType.TOB_XARPUS_SCREECH] ?? null)
        : null;

    let target = 0;
    let orientation = 0;
    return xarpus.stateByTick.map((state, tick) => {
      if (hardModeScreech !== null && tick >= hardModeScreech) {
        return null;
      }

      const attack = state?.attack?.attack;
      if (state !== null && attack === NpcAttack.TOB_XARPUS_SPIT) {
        const splat = xarpusSplats.find((evt) => evt.tick > tick);
        if (splat !== undefined) {
          const center = (state.size - 1) / 2;
          const dx = splat.xCoord - (state.position.x + center);
          const dy = splat.yCoord - (state.position.y + center);
          target =
            ((Math.atan2(-dx, -dy) * (MAX_ORIENTATION / 2)) / Math.PI +
              MAX_ORIENTATION) %
            MAX_ORIENTATION;
        }
      } else if (attack !== undefined) {
        target = TURN_ORIENTATIONS.get(attack) ?? target;
      }

      const start = orientation;
      orientation = turnToward(start, target, TURN_PER_TICK);
      return { start, target };
    });
  }, [challenge, xarpus, isLive, isLegacy, splatEvents]);

  const modifyEntity = useCallback(
    (tick: number, entity: AnyEntity) => {
      if (entity.type !== EntityType.NPC) {
        return entity;
      }

      const npcEntity = entity as NpcEntity;
      if (npcEntity.roomId !== xarpus?.roomId || isLive || isLegacy) {
        return entity;
      }

      if (Npc.isXarpusP1(npcEntity.id)) {
        npcEntity.options.sprite = { sheet: XARPUS_P1_FACINGS, orientation: 0 };
      } else {
        const facing = facings[tick] ?? null;
        if (facing !== null) {
          const { start, target } = facing;
          npcEntity.options.sprite = {
            sheet: XARPUS_FACINGS,
            orientation: target,
            turn: (progress) =>
              turnToward(start, target, TURN_PER_TICK * progress),
          };
        }
      }
      return entity;
    },
    [xarpus, isLive, isLegacy, facings],
  );

  const getEntities = useMapEntities(
    challenge,
    playerState,
    npcState,
    totalTicks,
    { customEntitiesForTick, modifyEntity },
  );
  const npcPreloads = usePreloads(npcState, isLive);
  const preloads = useMemo(
    () => [
      ...npcPreloads,
      XARPUS_FACINGS.url,
      XARPUS_P1_FACINGS.url,
      ACID_BALL.url,
      ACID_POOL.url,
      ACID_SPLASH.url,
    ],
    [npcPreloads],
  );

  if (loading || challenge === null) {
    return <Loading />;
  }

  const xarpusData = challenge.tobRooms.xarpus;
  if (!isLive && xarpusData === null) {
    return <MissingStageData stage={Stage.TOB_XARPUS} />;
  }

  const exhumedHealing = {
    none: 0,
    once: 0,
    twice: 0,
    many: 0,
  };
  for (const exhumed of exhumes) {
    if (exhumed.healTicks.length === 0) {
      exhumedHealing.none++;
    } else if (exhumed.healTicks.length === 1) {
      exhumedHealing.once++;
    } else if (exhumed.healTicks.length === 2) {
      exhumedHealing.twice++;
    } else {
      exhumedHealing.many++;
    }
  }

  const sections = [];

  if (
    challenge.splits[SplitType.TOB_XARPUS_EXHUMES] ||
    challenge.splits[SplitType.TOB_XARPUS_SCREECH]
  ) {
    sections.push({
      title: 'Phase Splits',
      content: (
        <div className={styles.phaseTimes}>
          {challenge.splits[SplitType.TOB_XARPUS_EXHUMES] && (
            <div className={styles.phaseTime}>
              <span className={styles.phaseLabel}>Exhumes:</span>
              <button
                className={styles.phaseValue}
                onClick={() => {
                  setTick(challenge.splits[SplitType.TOB_XARPUS_EXHUMES]!);
                }}
              >
                {ticksToFormattedSeconds(
                  challenge.splits[SplitType.TOB_XARPUS_EXHUMES],
                )}
              </button>
            </div>
          )}
          {challenge.splits[SplitType.TOB_XARPUS_SCREECH] && (
            <div className={styles.phaseTime}>
              <span className={styles.phaseLabel}>Screech:</span>
              <button
                className={styles.phaseValue}
                onClick={() => {
                  setTick(challenge.splits[SplitType.TOB_XARPUS_SCREECH]!);
                }}
              >
                {ticksToFormattedSeconds(
                  challenge.splits[SplitType.TOB_XARPUS_SCREECH],
                )}
              </button>
            </div>
          )}
        </div>
      ),
    });
  }

  if (challenge.tobStats.xarpusHealing !== null) {
    sections.push({
      title: 'Exhumed Healing',
      content: (
        <table className={styles.healingTable}>
          <thead>
            <tr>
              <th colSpan={4} className={styles.healingTableHeader}>
                <i className="fas fa-heart" /> Total Healing:{' '}
                {challenge.tobStats.xarpusHealing}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className={styles.healingTableSubHeader}>0 heals</th>
              <th className={styles.healingTableSubHeader}>1 heal</th>
              <th className={styles.healingTableSubHeader}>2 heals</th>
              <th className={styles.healingTableSubHeader}>&gt;2 heals</th>
            </tr>
            <tr>
              <td className={styles.healingTableAmount}>
                {exhumedHealing.none} exh
              </td>
              <td className={styles.healingTableAmount}>
                {exhumedHealing.once} exh
              </td>
              <td className={styles.healingTableAmount}>
                {exhumedHealing.twice} exh
              </td>
              <td className={styles.healingTableAmount}>
                {exhumedHealing.many} exh
              </td>
            </tr>
          </tbody>
        </table>
      ),
    });
  }

  return (
    <>
      <div className={bossStyles.overview}>
        <BossFightOverview
          name="Xarpus"
          className={styles.overview}
          image="/xarpus.webp"
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
          customStates={customStates}
        />
      </div>

      <div className={bossStyles.replayAndParty}>
        <BossPageReplay
          entities={getEntities(currentTick)}
          preloads={preloads}
          mapDef={mapDefinition}
          playing={playing}
          width={compact ? 330 : 540}
          height={compact ? 330 : 540}
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

      <div className={bossStyles.charts}>
        <Card
          className={bossStyles.chart}
          header={{ title: "Xarpus's Health By Tick" }}
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
