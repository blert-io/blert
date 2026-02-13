'use client';

import {
  ChallengeStatus,
  Coords,
  EventType,
  Npc,
  NpcAttack,
  NpcAttackEvent,
  NpcEvent,
  NpcId,
  SkillLevel,
  SplitType,
  Stage,
  TobRaid,
  VerzikHealEvent,
} from '@blert/common';
import { useCallback, useContext, useMemo, useRef } from 'react';

import { TimelineColor, TimelineSplit } from '@/components/attack-timeline';
import BossFightOverview from '@/components/boss-fight-overview';
import BossPageAttackTimeline, {
  CustomStateEntry,
} from '@/components/boss-page-attack-timeline';
import BossPageControls from '@/components/boss-page-controls';
import BossPageParty from '@/components/boss-page-party';
import BossPageReplay from '@/components/boss-page-replay';
import Card from '@/components/card';
import Loading from '@/components/loading';
import {
  AnyEntity,
  MapDefinition,
  ObjectEntity,
  Terrain,
} from '@/components/map-renderer';
import { useDisplay } from '@/display';
import { ActorContext } from '@/(challenges)/raids/tob/context';
import {
  useMapEntities,
  usePlayingState,
  useStageEvents,
} from '@/utils/boss-room-state';
import { ticksToFormattedSeconds } from '@/utils/tick';

import BarrierEntity from '../barrier';

import bossStyles from '../style.module.scss';
import styles from './style.module.scss';
import { inRect } from '@/utils/coords';

const VERZIK_MAP_DEFINITION: MapDefinition = {
  baseX: 3144,
  baseY: 4288,
  width: 48,
  height: 48,
  initialCameraPosition: {
    x: 3168.5,
    y: 4316,
  },
};

class VerzikTerrain implements Terrain {
  constructor(private readonly pillars: Coords[]) {}

  isPassable(coords: Coords): boolean {
    return !this.pillars.some((p) =>
      inRect(coords, { x: p.x, y: p.y, width: 3, height: 3 }),
    );
  }
}

const VERZIK_ATTACK_BACKGROUND = '#391717';

type RedCrabInfo = {
  tick: number;
  attackableTick: number;
  verzikStartHpPercentage?: number;
  verzikLowestHpPercentage?: number;
};

const BARRIER = new BarrierEntity({ x: 3296, y: 4256 }, 2);

export default function VerzikPage() {
  const display = useDisplay();

  const compact = display.isCompact();

  const {
    challenge,
    totalTicks,
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    bcf,
    loading,
  } = useStageEvents<TobRaid>(Stage.TOB_VERZIK);

  const { currentTick, setTick, playing, setPlaying, advanceTick } =
    usePlayingState(totalTicks);

  const mapDefinition = useMemo(() => {
    const pillarsThisTick: Coords[] = [];

    for (const event of eventsByTick[currentTick] ?? []) {
      if (
        event.type === EventType.NPC_SPAWN ||
        event.type === EventType.NPC_UPDATE
      ) {
        const npcEvent = event as NpcEvent;
        if (npcEvent.npc.id === (NpcId.VERZIK_PILLAR as number)) {
          pillarsThisTick.push({ x: npcEvent.xCoord, y: npcEvent.yCoord });
        }
      }
    }

    const terrain = new VerzikTerrain(pillarsThisTick);
    const initialZoom = compact ? 11 : 23.5;

    return {
      ...VERZIK_MAP_DEFINITION,
      terrain,
      initialZoom,
    };
  }, [compact, eventsByTick, currentTick]);

  const { selectedActor, setSelectedActor } = useContext(ActorContext);

  const redCrabInfoRef = useRef<HTMLDivElement>(null);

  const [splits, redsInfo, backgroundColors] = useMemo(() => {
    if (challenge === null) {
      return [[], [], []];
    }

    const splits: TimelineSplit[] = [];
    if (challenge.splits[SplitType.TOB_VERZIK_P1_END]) {
      splits.push({
        tick: challenge.splits[SplitType.TOB_VERZIK_P1_END],
        splitName: 'P1 End',
        unimportant: true,
      });
      splits.push({
        tick: challenge.splits[SplitType.TOB_VERZIK_P1_END] + 13,
        splitName: 'P2',
      });
    }
    if (challenge.splits[SplitType.TOB_VERZIK_P2_END]) {
      splits.push({
        tick: challenge.splits[SplitType.TOB_VERZIK_P2_END],
        splitName: 'P2 End',
        unimportant: true,
      });
      splits.push({
        tick: challenge.splits[SplitType.TOB_VERZIK_P2_END] + 6,
        splitName: 'P3',
      });
    }

    const backgroundColors: TimelineColor[] = [];
    eventsByType[EventType.NPC_ATTACK]?.forEach((event) => {
      switch ((event as NpcAttackEvent).npcAttack.attack) {
        case NpcAttack.TOB_VERZIK_P1_AUTO:
          backgroundColors.push({
            tick: event.tick,
            backgroundColor: VERZIK_ATTACK_BACKGROUND,
          });
          break;
        case NpcAttack.TOB_VERZIK_P2_BOUNCE:
        case NpcAttack.TOB_VERZIK_P2_CABBAGE:
        case NpcAttack.TOB_VERZIK_P2_MAGE:
        case NpcAttack.TOB_VERZIK_P2_PURPLE:
        case NpcAttack.TOB_VERZIK_P2_ZAP:
          // Highlight the P2 danger tick, which is the tick before her attacks.
          backgroundColors.push({
            tick: event.tick - 1,
            backgroundColor: VERZIK_ATTACK_BACKGROUND,
          });
          break;
      }
    });

    const redsTicks: number[] = [];
    eventsByType[EventType.NPC_SPAWN]?.forEach((event) => {
      if (Npc.isVerzikMatomenos((event as NpcEvent).npc.id)) {
        if (!redsTicks.includes(event.tick)) {
          redsTicks.push(event.tick);
        }
      }
    });

    const info: RedCrabInfo[] = [];

    for (let i = 0; i < redsTicks.length; i++) {
      const tick = redsTicks[i];
      const attackableTick = tick + 10;

      splits.push({
        tick,
        splitName: i === 0 ? 'Reds' : `Reds ${i + 1}`,
        unimportant: tick !== challenge?.splits[SplitType.TOB_VERZIK_REDS],
      });

      splits.push({
        tick: attackableTick,
        splitName: 'Attackable',
        unimportant: true,
      });

      const getVerzikHp = (tick: number) => {
        const event = eventsByTick[tick]?.find(
          (e) =>
            e.type === EventType.NPC_UPDATE &&
            Npc.isVerzikP2((e as NpcEvent).npc.id),
        );
        if (event === undefined) {
          return undefined;
        }
        return SkillLevel.fromRaw(
          (event as NpcEvent).npc.hitpoints,
        ).percentage();
      };

      const verzikStartHpPercentage = getVerzikHp(attackableTick);
      let verzikLowestHpPercentage;

      const nextCrabsTick =
        i < redsTicks.length - 1 ? redsTicks[i + 1] : undefined;
      if (nextCrabsTick !== undefined) {
        for (let tick = attackableTick; tick < nextCrabsTick; tick++) {
          const hp = getVerzikHp(tick);
          if (verzikLowestHpPercentage === undefined) {
            verzikLowestHpPercentage = hp;
          } else if (hp !== undefined && hp < verzikLowestHpPercentage) {
            verzikLowestHpPercentage = hp;
          }
        }
      } else {
        verzikLowestHpPercentage = 0;
      }

      info.push({
        tick,
        attackableTick,
        verzikStartHpPercentage,
        verzikLowestHpPercentage,
      });
    }
    return [splits, info, backgroundColors];
  }, [challenge, eventsByType, eventsByTick]);

  const customStates = useMemo(() => {
    const entries: CustomStateEntry[] = [];

    eventsByType[EventType.TOB_VERZIK_HEAL]?.forEach((event) => {
      const { player, healAmount } = (event as VerzikHealEvent).verzikHeal;
      entries.push({
        playerName: player,
        tick: event.tick,
        states: [
          {
            iconUrl: '/images/npcs/8386.webp',
            label: healAmount.toString(),
            fullText:
              healAmount > 0
                ? `Healed Verzik for ${healAmount}`
                : 'Healed Verzik',
          },
        ],
      });
    });

    return entries;
  }, [eventsByType]);

  const customEntitiesForTick = useCallback(
    (tick: number) => {
      const entities: AnyEntity[] = [BARRIER];

      const yellowsEvent = eventsByTick[tick]?.find(
        (e) => e.type === EventType.TOB_VERZIK_YELLOWS,
      );
      if (yellowsEvent !== undefined) {
        for (const yellow of yellowsEvent.verzikYellows) {
          entities.push(
            new ObjectEntity(
              yellow,
              '/verzik_p3_yellow.webp',
              'Verzik yellow pool',
              1,
              undefined,
              true,
            ),
          );
        }
      }

      return entities;
    },
    [eventsByTick],
  );

  const { entitiesByTick, preloads } = useMapEntities(
    challenge,
    playerState,
    npcState,
    totalTicks,
    { customEntitiesForTick },
  );

  if (loading || challenge === null) {
    return <Loading />;
  }

  const verzikData = challenge.tobRooms.verzik;
  if (challenge.status !== ChallengeStatus.IN_PROGRESS && verzikData === null) {
    return <>No Verzik data for this raid</>;
  }

  const playerTickState = challenge.party.reduce(
    (acc, { username }) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  const sections = [];

  if (
    challenge.splits[SplitType.TOB_VERZIK_P1_END] ||
    challenge.splits[SplitType.TOB_VERZIK_REDS] ||
    challenge.splits[SplitType.TOB_VERZIK_P2_END]
  ) {
    sections.push({
      title: 'Phase Splits',
      content: (
        <div className={styles.phaseTimes}>
          {challenge.splits[SplitType.TOB_VERZIK_P1_END] && (
            <div className={styles.phaseTime}>
              <span className={styles.phaseLabel}>P1:</span>
              <button
                className={styles.phaseValue}
                onClick={() => {
                  setTick(challenge.splits[SplitType.TOB_VERZIK_P1_END]!);
                }}
              >
                {ticksToFormattedSeconds(
                  challenge.splits[SplitType.TOB_VERZIK_P1_END],
                )}
              </button>
            </div>
          )}
          {challenge.splits[SplitType.TOB_VERZIK_REDS] && (
            <div className={styles.phaseTime}>
              <span className={styles.phaseLabel}>Reds:</span>
              <button
                className={styles.phaseValue}
                onClick={() => {
                  setTick(challenge.splits[SplitType.TOB_VERZIK_REDS]!);
                }}
              >
                {ticksToFormattedSeconds(
                  challenge.splits[SplitType.TOB_VERZIK_REDS],
                )}
              </button>
            </div>
          )}
          {challenge.splits[SplitType.TOB_VERZIK_P2_END] && (
            <div className={styles.phaseTime}>
              <span className={styles.phaseLabel}>P2:</span>
              <button
                className={styles.phaseValue}
                onClick={() => {
                  setTick(challenge.splits[SplitType.TOB_VERZIK_P2_END]!);
                }}
              >
                {ticksToFormattedSeconds(
                  challenge.splits[SplitType.TOB_VERZIK_P2_END],
                )}
              </button>
            </div>
          )}
        </div>
      ),
    });
  }

  if (verzikData?.redsSpawnCount !== undefined) {
    sections.push({
      title: 'Stats',
      content: (
        <div className={styles.stats}>
          <div className={styles.redCrabCount}>
            <div className={styles.redCrabLabel}>
              Reds Spawn Count:
              <button
                onClick={() => {
                  redCrabInfoRef.current?.scrollIntoView({
                    behavior: 'smooth',
                  });
                }}
              >
                View Spawns
              </button>
            </div>
            <span className={styles.redCrabValue}>
              {verzikData.redsSpawnCount}
            </span>
          </div>
        </div>
      ),
    });
  }

  return (
    <>
      <div className={bossStyles.overview}>
        <BossFightOverview
          className={styles.overview}
          name="Verzik Vitur"
          image="/verzik.webp"
          time={totalTicks}
          sections={sections}
        />
      </div>

      <div className={bossStyles.timeline}>
        <BossPageAttackTimeline
          currentTick={currentTick}
          playing={playing}
          playerState={playerState}
          timelineTicks={totalTicks}
          updateTickOnPage={setTick}
          splits={splits}
          npcs={npcState}
          bcf={bcf}
          backgroundColors={backgroundColors}
          smallLegend={display.isCompact()}
          customStates={customStates}
        />
      </div>

      <div className={bossStyles.replayAndParty}>
        <BossPageReplay
          entities={entitiesByTick.get(currentTick) ?? []}
          preloads={preloads}
          mapDef={mapDefinition}
          playing={playing}
          width={compact ? 348 : 725}
          height={compact ? 300 : 625}
          currentTick={currentTick}
          advanceTick={advanceTick}
        />
        <BossPageParty
          playerTickState={playerTickState}
          selectedActor={selectedActor}
          setSelectedActor={setSelectedActor}
        />
      </div>

      {verzikData?.redsSpawnCount !== undefined && (
        <Card
          className={styles.redCrabAnalysis}
          header={{ title: 'Red Crabs Phases' }}
        >
          <div className={styles.redCrabInfo} ref={redCrabInfoRef}>
            {redsInfo.map((info, i) => {
              const startHp = info.verzikStartHpPercentage ?? 0;
              const lowestHp = info.verzikLowestHpPercentage ?? 0;
              const hpDifference = startHp - lowestHp;
              const hpPercentage = (lowestHp / startHp) * 100;

              let hpDifferenceClass = '';
              let hpDifferenceIcon: React.ReactNode = '';
              if (Math.abs(hpDifference) < 3) {
                hpDifferenceIcon = '~';
              } else if (hpDifference > 0) {
                hpDifferenceClass = styles.hpDifferenceUp;
                hpDifferenceIcon = <i className="fas fa-arrow-down" />;
              } else {
                hpDifferenceClass = styles.hpDifferenceDown;
                hpDifferenceIcon = <i className="fas fa-arrow-up" />;
              }

              return (
                <div key={info.tick} className={styles.redCrabInfoItem}>
                  <div className={styles.redCrabInfoLabel}>
                    Reds {i + 1}
                    <span className={styles.redCrabTick}>
                      {ticksToFormattedSeconds(info.tick)}
                    </span>
                  </div>
                  <div className={styles.redCrabInfoContent}>
                    <div className={`${styles.hpInfo} ${styles.starting}`}>
                      <span className={styles.hpLabel}>Starting HP</span>
                      <span className={styles.hpValue}>
                        {startHp.toFixed(2)}%
                      </span>
                    </div>
                    <div className={`${styles.hpInfo} ${styles.lowest}`}>
                      <span className={styles.hpLabel}>Lowest HP</span>
                      <span className={styles.hpValue}>
                        {lowestHp.toFixed(2)}%
                        <div className={styles.hpBar}>
                          <div
                            className={styles.hpFill}
                            style={{ width: `${hpPercentage}%` }}
                          />
                        </div>
                      </span>
                    </div>
                    <div className={`${styles.hpInfo} ${styles.difference}`}>
                      <span className={styles.hpLabel}>Change</span>
                      <div
                        className={`${styles.hpDifference} ${hpDifferenceClass}`}
                      >
                        {hpDifferenceIcon}
                        {Math.abs(hpDifference).toFixed(2)}%
                      </div>
                    </div>
                  </div>
                  <button
                    className={styles.jumpButton}
                    onClick={() => setTick(info.tick)}
                  >
                    <i className="fa-solid fa-play" />
                    Jump to spawn
                  </button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <BossPageControls
        currentlyPlaying={playing}
        totalTicks={totalTicks}
        currentTick={currentTick}
        updateTick={setTick}
        updatePlayingState={setPlaying}
        splits={splits}
      />
    </>
  );
}
