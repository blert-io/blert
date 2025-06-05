'use client';

import {
  ChallengeStatus,
  EventType,
  Npc,
  NpcAttack,
  NpcAttackEvent,
  NpcEvent,
  NpcId,
  PlayerUpdateEvent,
  SkillLevel,
  SplitType,
  Stage,
  TobRaid,
  VerzikYellowsEvent,
} from '@blert/common';
import Image from 'next/image';
import { useContext, useMemo, useRef } from 'react';

import { TimelineColor, TimelineSplit } from '@/components/attack-timeline';
import BossFightOverview from '@/components/boss-fight-overview';
import BossPageAttackTimeline from '@/components/boss-page-attack-timeline';
import BossPageControls from '@/components/boss-page-controls';
import BossPageParty from '@/components/boss-page-party';
import BossPageReplay from '@/components/boss-page-replay';
import Card from '@/components/card';
import Loading from '@/components/loading';
import {
  Entity,
  NpcEntity,
  OverlayEntity,
  PlayerEntity,
} from '@/components/map';
import { useDisplay } from '@/display';
import { ActorContext } from '@/raids/tob/context';
import { usePlayingState, useStageEvents } from '@/utils/boss-room-state';
import { ticksToFormattedSeconds } from '@/utils/tick';

import bossStyles from '../style.module.scss';
import styles from './style.module.scss';
import verzikBaseTiles from './verzik-tiles.json';

const VERZIK_MAP_DEFINITION = {
  baseX: 3154,
  baseY: 4302,
  width: 29,
  height: 25,
  baseTiles: verzikBaseTiles,
};

const VERZIK_ATTACK_BACKGROUND = '#391717';

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

type RedCrabInfo = {
  tick: number;
  attackableTick: number;
  verzikStartHpPercentage?: number;
  verzikLowestHpPercentage?: number;
};

export default function VerzikPage() {
  const display = useDisplay();

  const {
    challenge: raidData,
    totalTicks,
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    loading,
  } = useStageEvents<TobRaid>(Stage.TOB_VERZIK);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const { selectedPlayer, setSelectedPlayer } = useContext(ActorContext);

  const redCrabInfoRef = useRef<HTMLDivElement>(null);

  const [splits, redsInfo, backgroundColors] = useMemo(() => {
    if (raidData === null) {
      return [[], [], []];
    }

    const splits: TimelineSplit[] = [];
    if (raidData.splits[SplitType.TOB_VERZIK_P1_END]) {
      splits.push({
        tick: raidData.splits[SplitType.TOB_VERZIK_P1_END],
        splitName: 'P1 End',
        unimportant: true,
      });
      splits.push({
        tick: raidData.splits[SplitType.TOB_VERZIK_P1_END] + 13,
        splitName: 'P2',
      });
    }
    if (raidData.splits[SplitType.TOB_VERZIK_P2_END]) {
      splits.push({
        tick: raidData.splits[SplitType.TOB_VERZIK_P2_END],
        splitName: 'P2 End',
        unimportant: true,
      });
      splits.push({
        tick: raidData.splits[SplitType.TOB_VERZIK_P2_END] + 6,
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
        unimportant: tick !== raidData?.splits[SplitType.TOB_VERZIK_REDS],
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
  }, [raidData, eventsByType, eventsByTick]);

  if (loading || raidData === null) {
    return <Loading />;
  }

  const verzikData = raidData.tobRooms.verzik;
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
        const hitpoints = e.player.hitpoints
          ? SkillLevel.fromRaw(e.player.hitpoints)
          : undefined;
        const player = new PlayerEntity(
          e.xCoord,
          e.yCoord,
          e.player.name,
          hitpoints,
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
            SkillLevel.fromRaw(e.npc.hitpoints),
            verzikNpcColor(e.npc.id),
          ),
        );
        break;
      }
    }
  }

  const yellowsEvent = eventsForCurrentTick.find(
    (e) => e.type === EventType.TOB_VERZIK_YELLOWS,
  ) as VerzikYellowsEvent | undefined;
  if (yellowsEvent !== undefined) {
    for (const yellow of yellowsEvent.verzikYellows) {
      entities.push(
        new OverlayEntity(
          yellow.x,
          yellow.y,
          'yellow',
          (
            <Image
              src="/verzik_p3_yellow.webp"
              alt="Verzik yellow pool"
              fill
              style={{ objectFit: 'contain' }}
            />
          ),
          /*interactable=*/ false,
          /*size=*/ 1,
          /*customZIndex=*/ 0,
        ),
      );
    }
  }

  const playerTickState = raidData.party.reduce(
    (acc, { username }) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  const sections = [];

  if (
    raidData.splits[SplitType.TOB_VERZIK_P1_END] ||
    raidData.splits[SplitType.TOB_VERZIK_REDS] ||
    raidData.splits[SplitType.TOB_VERZIK_P2_END]
  ) {
    sections.push({
      title: 'Phase Splits',
      content: (
        <div className={styles.phaseTimes}>
          {raidData.splits[SplitType.TOB_VERZIK_P1_END] && (
            <div className={styles.phaseTime}>
              <span className={styles.phaseLabel}>P1:</span>
              <button
                className={styles.phaseValue}
                onClick={() => {
                  updateTickOnPage(
                    raidData.splits[SplitType.TOB_VERZIK_P1_END]!,
                  );
                }}
              >
                {ticksToFormattedSeconds(
                  raidData.splits[SplitType.TOB_VERZIK_P1_END],
                )}
              </button>
            </div>
          )}
          {raidData.splits[SplitType.TOB_VERZIK_REDS] && (
            <div className={styles.phaseTime}>
              <span className={styles.phaseLabel}>Reds:</span>
              <button
                className={styles.phaseValue}
                onClick={() => {
                  updateTickOnPage(raidData.splits[SplitType.TOB_VERZIK_REDS]!);
                }}
              >
                {ticksToFormattedSeconds(
                  raidData.splits[SplitType.TOB_VERZIK_REDS],
                )}
              </button>
            </div>
          )}
          {raidData.splits[SplitType.TOB_VERZIK_P2_END] && (
            <div className={styles.phaseTime}>
              <span className={styles.phaseLabel}>P2:</span>
              <button
                className={styles.phaseValue}
                onClick={() => {
                  updateTickOnPage(
                    raidData.splits[SplitType.TOB_VERZIK_P2_END]!,
                  );
                }}
              >
                {ticksToFormattedSeconds(
                  raidData.splits[SplitType.TOB_VERZIK_P2_END],
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
                className={styles.redCrabButton}
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
          updateTickOnPage={updateTickOnPage}
          splits={splits}
          npcs={npcState}
          backgroundColors={backgroundColors}
          smallLegend={display.isCompact()}
        />
      </div>

      <div className={bossStyles.replayAndParty}>
        <BossPageReplay
          entities={entities}
          mapDef={VERZIK_MAP_DEFINITION}
          tileSize={display.isCompact() ? 12 : undefined}
        />
        <BossPageParty
          playerTickState={playerTickState}
          selectedPlayer={selectedPlayer}
          setSelectedPlayer={setSelectedPlayer}
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
                hpDifferenceClass = styles.hpDifferenceLow;
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
                    onClick={() => updateTickOnPage(info.tick)}
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
        updateTick={updateTickOnPage}
        updatePlayingState={setPlaying}
        splits={splits}
      />
    </>
  );
}
