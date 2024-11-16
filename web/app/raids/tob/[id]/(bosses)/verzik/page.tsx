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
} from '@blert/common';
import Image from 'next/image';
import { useContext, useMemo } from 'react';

import { usePlayingState, useStageEvents } from '@/utils/boss-room-state';
import { BossPageControls } from '@/components/boss-page-controls/boss-page-controls';
import { BossPageAttackTimeline } from '@/components/boss-page-attack-timeline/boss-page-attack-timeline';
import AttackTimeline, { TimelineColor } from '@/components/attack-timeline';
import Badge from '@/components/badge';
import BossPageReplay from '@/components/boss-page-replay';
import CollapsiblePanel from '@/components/collapsible-panel';
import Loading from '@/components/loading';
import { Entity, NpcEntity, PlayerEntity } from '@/components/map';
import Tabs from '@/components/tabs';
import { DisplayContext } from '@/display';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { ActorContext } from '../../../context';

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

export default function VerzikPage() {
  const {
    challenge: raidData,
    totalTicks,
    eventsByTick,
    eventsByType,
    playerState,
    npcState,
    loading,
  } = useStageEvents<TobRaid>(Stage.TOB_VERZIK);

  const display = useContext(DisplayContext);

  const { currentTick, updateTickOnPage, playing, setPlaying } =
    usePlayingState(totalTicks);

  const { selectedPlayer } = useContext(ActorContext);

  const [splits, backgroundColors] = useMemo(() => {
    if (raidData === null) {
      return [[], []];
    }

    const splits = [];
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

    const redsTicks: number[] = [];
    eventsByType[EventType.NPC_SPAWN]?.forEach((event) => {
      if (Npc.isVerzikMatomenos((event as NpcEvent).npc.id)) {
        if (!redsTicks.includes(event.tick)) {
          redsTicks.push(event.tick);
        }
      }
    });
    redsTicks.forEach((tick, i) => {
      splits.push({
        tick,
        splitName: i === 0 ? 'Reds' : `Reds ${i + 1}`,
        unimportant: tick !== raidData.splits[SplitType.TOB_VERZIK_REDS],
      });

      splits.push({
        tick: tick + 10,
        splitName: 'Attackable',
        unimportant: true,
      });
    });

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

    return [splits, backgroundColors];
  }, [raidData, eventsByType]);

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

  const playerTickState = raidData.party.reduce(
    (acc, { username }) => ({
      ...acc,
      [username]: playerState.get(username)?.at(currentTick) ?? null,
    }),
    {},
  );

  if (display.isCompact()) {
    let maxHeight;
    let timelineWrapWidth = 380;
    if (window) {
      maxHeight = window.innerHeight - 255;
      timelineWrapWidth = window.innerWidth - 25;
    }

    return (
      <div className={bossStyles.bossPageCompact}>
        <h1>
          <i className="fas fa-bullseye" />
          Verzik Vitur ({ticksToFormattedSeconds(totalTicks)})
        </h1>
        <Tabs
          fluid
          maxHeight={maxHeight}
          tabs={[
            {
              icon: 'fas fa-chart-simple',
              content: (
                <div>
                  <div className={styles.splits}>
                    {raidData.splits[SplitType.TOB_VERZIK_P1_END] && (
                      <Badge
                        className={styles.split}
                        iconClass="fa-solid fa-hourglass"
                        label="P1"
                        value={ticksToFormattedSeconds(
                          raidData.splits[SplitType.TOB_VERZIK_P1_END],
                        )}
                      />
                    )}
                    {raidData.splits[SplitType.TOB_VERZIK_REDS] && (
                      <Badge
                        className={styles.split}
                        iconClass="fa-solid fa-hourglass"
                        label="Reds"
                        value={ticksToFormattedSeconds(
                          raidData.splits[SplitType.TOB_VERZIK_REDS],
                        )}
                      />
                    )}
                    {raidData.splits[SplitType.TOB_VERZIK_P2_END] && (
                      <Badge
                        className={styles.split}
                        iconClass="fa-solid fa-hourglass"
                        label="P2"
                        value={ticksToFormattedSeconds(
                          raidData.splits[SplitType.TOB_VERZIK_P2_END],
                        )}
                      />
                    )}
                  </div>
                  <div>
                    <label
                      style={{ fontWeight: 500, color: '#fff', marginRight: 8 }}
                    >
                      Red crab spawns:
                    </label>
                    <span>
                      {raidData.tobRooms.verzik?.redsSpawnCount ?? '-'}
                    </span>
                  </div>
                </div>
              ),
            },
            {
              icon: 'fas fa-timeline',
              content: (
                <div className={bossStyles.timeline}>
                  <AttackTimeline
                    currentTick={currentTick}
                    playing={playing}
                    playerState={playerState}
                    timelineTicks={totalTicks}
                    updateTickOnPage={updateTickOnPage}
                    splits={splits}
                    npcs={npcState}
                    cellSize={20}
                    wrapWidth={timelineWrapWidth}
                    smallLegend
                  />
                </div>
              ),
            },
            {
              icon: 'fas fa-gamepad',
              content: (
                <div>
                  <BossPageReplay
                    entities={entities}
                    mapDef={VERZIK_MAP_DEFINITION}
                    playerTickState={playerTickState}
                    tileSize={14}
                  />
                </div>
              ),
            },
          ]}
        />
        <BossPageControls
          currentlyPlaying={playing}
          totalTicks={totalTicks}
          currentTick={currentTick}
          updateTick={updateTickOnPage}
          updatePlayingState={setPlaying}
          splits={splits}
        />
      </div>
    );
  }

  return (
    <>
      <div className={bossStyles.bossPage__Overview}>
        <div className={bossStyles.bossPage__BossPic}>
          <Image
            src="/verzik.webp"
            alt="Verzik Vitur"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={bossStyles.bossPage__KeyDetails}>
          <h2>Verzik Vitur ({ticksToFormattedSeconds(totalTicks)})</h2>
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

      <CollapsiblePanel
        panelTitle="Room Replay"
        maxPanelHeight={2000}
        defaultExpanded={true}
      >
        <BossPageReplay
          entities={entities}
          mapDef={VERZIK_MAP_DEFINITION}
          playerTickState={playerTickState}
        />
      </CollapsiblePanel>

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
