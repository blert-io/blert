'use client';

import {
  AttackStyle,
  Coords,
  EventType,
  MokhaiotlChallenge,
  MokhaiotlOrbEvent,
  MokhaiotlOrbSource,
  NpcAttack,
  Stage,
} from '@blert/common';
import Image from 'next/image';
import { use, useCallback, useContext, useMemo } from 'react';

import BossFightOverview from '@/components/boss-fight-overview';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import BossPageControls from '@/components/boss-page-controls';
import BossPageParty from '@/components/boss-page-party';
import BossPageReplay from '@/components/boss-page-replay';
import Loading from '@/components/loading';
import {
  AnyEntity,
  ObjectEntity,
  MapDefinition,
  PlayerEntity,
} from '@/components/map-renderer';
import { useDisplay } from '@/display';
import {
  useMapEntities,
  usePlayingState,
  useStageEvents,
} from '@/utils/boss-room-state';

import { ActorContext } from '../../../context';
import { MokhaiotlOrb } from './mokhaiotl-orb';

import styles from './style.module.scss';

type DelvePageProps = {
  params: Promise<{ number: string }>;
};

export default function DelvePage({ params }: DelvePageProps) {
  const { number } = use(params);
  const display = useDisplay();

  const compact = display.isCompact();

  const { selectedActor, setSelectedActor } = useContext(ActorContext);

  const [delve, stage, attempt] = useMemo(() => {
    const delve = Number.parseInt(number, 10);
    if (Number.isNaN(delve) || delve < 1) {
      return [1, Stage.MOKHAIOTL_DELVE_1, undefined];
    }

    const stage = Stage.MOKHAIOTL_DELVE_1 + Math.min(delve, 9) - 1;
    const attempt = delve > 8 ? delve - 8 : undefined;
    return [delve, stage, attempt] as const;
  }, [number]);

  const mapDefinition = useMemo(() => {
    let baseCoords;
    let initialCameraPosition;
    if (delve === 1) {
      baseCoords = {
        baseX: 1288,
        baseY: 9552,
      };
      initialCameraPosition = {
        x: 1311,
        y: 9572,
      };
    } else if (delve < 6) {
      baseCoords = {
        baseX: 3400,
        baseY: 6416,
      };
      initialCameraPosition = {
        x: 3423,
        y: 6436,
      };
    } else {
      baseCoords = {
        baseX: 3528,
        baseY: 6416,
      };
      initialCameraPosition = {
        x: 3551,
        y: 6438,
      };
    }

    const initialZoom = compact ? 13 : 30;
    const mapDef: MapDefinition = {
      ...baseCoords,
      width: 48,
      height: 48,
      plane: 0,
      initialZoom,
      initialCameraPosition,
    };

    return mapDef;
  }, [delve, compact]);

  const {
    challenge,
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    bcf,
    totalTicks,
    loading,
  } = useStageEvents<MokhaiotlChallenge>(stage, attempt);

  const { currentTick, setTick, playing, setPlaying, advanceTick } =
    usePlayingState(totalTicks);

  const orbsRow = useMemo(() => {
    const ballAttacks = new Set([
      NpcAttack.MOKHAIOTL_BALL,
      NpcAttack.MOKHAIOTL_MAGE_BALL,
      NpcAttack.MOKHAIOTL_RANGED_BALL,
    ]);
    const events =
      (eventsByType[EventType.MOKHAIOTL_ORB] as MokhaiotlOrbEvent[]) ?? [];
    const orbsByEndTick = new Map(
      events.map((event) => [event.mokhaiotlOrb.endTick, event.mokhaiotlOrb]),
    );

    // Collect ticks on which Mokhaiotl used a ball attack, sorted ascending.
    const ballAttackTicks: [number, NpcAttack][] = [];
    for (const [, npc] of npcState) {
      for (let tick = 0; tick < totalTicks; tick++) {
        const state = npc.stateByTick[tick];
        if (state?.attack && ballAttacks.has(state.attack.type)) {
          ballAttackTicks.push([tick, state.attack.type]);
        }
      }
    }
    ballAttackTicks.sort((a, b) => a[0] - b[0]);

    /** Find the latest ball attack tick before `beforeTick`. */
    function findBallAttackBefore(
      beforeTick: number,
    ): [number, NpcAttack] | undefined {
      let result: [number, NpcAttack] | undefined;
      for (const t of ballAttackTicks) {
        if (t[0] >= beforeTick) {
          break;
        }
        result = t;
      }
      return result;
    }

    const styleString: Record<AttackStyle, string> = {
      [AttackStyle.MELEE]: 'melee',
      [AttackStyle.RANGE]: 'ranged',
      [AttackStyle.MAGE]: 'magic',
    };

    const styleName: Record<AttackStyle, string> = {
      [AttackStyle.MELEE]: 'Melee',
      [AttackStyle.RANGE]: 'Ranged',
      [AttackStyle.MAGE]: 'Magic',
    };

    return {
      name: 'Orbs',
      cellRenderer: (tick: number, size: number) => {
        const orb = orbsByEndTick.get(tick);
        if (orb === undefined) {
          return null;
        }
        return (
          <Image
            src={`/images/mokhaiotl/${styleString[orb.style]}-orb.png`}
            alt={`Mokhaiotl ${orb.style} orb`}
            height={size - 2}
            width={size - 2}
            style={{ objectFit: 'contain', opacity: 0.5 }}
          />
        );
      },
      tooltipRenderer: (tick: number) => {
        const orb = orbsByEndTick.get(tick);
        if (orb === undefined) {
          return null;
        }

        let source: string;
        if (orb.source === MokhaiotlOrbSource.MOKHAIOTL) {
          source = `Launched by boss on tick ${orb.startTick}`;
        } else {
          const sourceBall = findBallAttackBefore(orb.startTick);
          if (sourceBall !== undefined) {
            const ballType =
              sourceBall[1] === NpcAttack.MOKHAIOTL_MAGE_BALL
                ? 'magic ball'
                : sourceBall[1] === NpcAttack.MOKHAIOTL_RANGED_BALL
                  ? 'ranged ball'
                  : 'unknown ball';
            source = `From ${ballType} on tick ${sourceBall[0]}`;
          } else {
            source = 'From ball';
          }
        }

        const travelTicks = orb.endTick - orb.startTick;
        return (
          <div style={{ fontSize: '0.85rem' }}>
            <Image
              src={`/images/mokhaiotl/${styleString[orb.style]}-orb.png`}
              alt={styleName[orb.style]}
              height={18}
              width={18}
              style={{ objectFit: 'contain', verticalAlign: 'middle' }}
            />{' '}
            {styleName[orb.style]} orb landed after {travelTicks} tick
            {travelTicks === 1 ? '' : 's'}
            <div className={styles.orbSource}>{source}</div>
          </div>
        );
      },
    };
  }, [eventsByType, npcState, totalTicks]);

  const [rocksByTick, splatsByTick] = useMemo(() => {
    const rocks = new Map<number, Coords[]>();
    const splats = new Map<number, Coords[]>();

    const activeRocks = new Set<string>();
    const activeSplats = new Set<string>();

    for (let tick = 0; tick < totalTicks; tick++) {
      const objectsEvent = eventsByTick[tick]?.find(
        (event) => event.type === EventType.MOKHAIOTL_OBJECTS,
      );

      const key = (coords: Coords) => `${coords.x}-${coords.y}`;
      const coordsFromKey = (key: string) => {
        const [x, y] = key.split('-').map(Number);
        return { x, y };
      };

      if (objectsEvent !== undefined) {
        const { rocksSpawned, splatsSpawned, rocksDespawned, splatsDespawned } =
          objectsEvent.mokhaiotlObjects;
        for (const rock of rocksSpawned) {
          activeRocks.add(key(rock));
        }
        for (const splat of splatsSpawned) {
          activeSplats.add(key(splat));
        }
        for (const rock of rocksDespawned) {
          activeRocks.delete(key(rock));
        }
        for (const splat of splatsDespawned) {
          activeSplats.delete(key(splat));
        }
      }

      rocks.set(tick, Array.from(activeRocks).map(coordsFromKey));
      splats.set(tick, Array.from(activeSplats).map(coordsFromKey));
    }

    return [rocks, splats];
  }, [eventsByTick, totalTicks]);

  const customEntitiesForTick = useCallback(
    (tick: number) => {
      const entities: AnyEntity[] = [];
      if (challenge === null) {
        return entities;
      }

      const rocks = rocksByTick.get(tick);
      if (rocks) {
        for (const rock of rocks) {
          entities.push(
            new ObjectEntity(
              rock,
              '/images/objects/mokhaiotl-rock.png',
              'Rock',
              1,
              '#958442',
            ),
          );
        }
      }

      const splats = splatsByTick.get(tick);
      if (splats) {
        for (const splat of splats) {
          entities.push(
            new ObjectEntity(
              splat,
              '/images/objects/mokhaiotl-acid.png',
              'Splat',
              1,
              '#958442',
              true,
            ),
          );
        }
      }

      const orbs = (
        (eventsByType[EventType.MOKHAIOTL_ORB] as MokhaiotlOrbEvent[]) ?? []
      ).filter(
        ({ mokhaiotlOrb }) =>
          tick >= mokhaiotlOrb.startTick && tick <= mokhaiotlOrb.endTick,
      );

      entities.push(
        ...orbs.map(({ mokhaiotlOrb: orb }) => {
          const uniqueId = `orb-${orb.sourcePoint.x}-${orb.sourcePoint.y}-${orb.style}-${orb.startTick}`;
          const targetPlayerId = PlayerEntity.uniqueId(
            challenge.party[0].username,
          );
          const totalTravelTicks = orb.endTick - orb.startTick;
          const currentTravelTick = tick - orb.startTick;

          return new MokhaiotlOrb(
            orb.sourcePoint,
            orb.style,
            targetPlayerId,
            totalTravelTicks,
            currentTravelTick,
            uniqueId,
          );
        }),
      );

      return entities;
    },
    [challenge, eventsByType, rocksByTick, splatsByTick],
  );

  const { entitiesByTick, preloads } = useMapEntities(
    challenge,
    playerState,
    npcState,
    totalTicks,
    { customEntitiesForTick },
  );

  if (challenge === null || loading) {
    return <Loading />;
  }

  const playerTickState = challenge.party.reduce(
    (acc, { username }) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  return (
    <div className={styles.delvePage}>
      <div className={styles.overview}>
        <BossFightOverview
          name={`Delve ${delve}`}
          className={styles.overview}
          image="/images/mokhaiotl.webp"
          time={totalTicks}
          sections={[]}
        />
      </div>

      <div className={styles.timeline}>
        <BossPageAttackTimeline
          currentTick={currentTick}
          playing={playing}
          playerState={playerState}
          timelineTicks={totalTicks}
          updateTickOnPage={setTick}
          npcs={npcState}
          bcf={bcf}
          smallLegend={display.isCompact()}
          customRows={[orbsRow]}
        />
      </div>

      <div className={styles.replayAndParty}>
        <BossPageReplay
          entities={entitiesByTick.get(currentTick) ?? []}
          preloads={preloads}
          mapDef={mapDefinition}
          playing={playing}
          width={compact ? 330 : 900}
          height={compact ? 330 : 900}
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
        totalTicks={totalTicks}
        currentTick={currentTick}
        updateTick={setTick}
        updatePlayingState={setPlaying}
      />
    </div>
  );
}
