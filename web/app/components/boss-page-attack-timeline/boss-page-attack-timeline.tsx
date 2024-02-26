'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { RaidContext } from '../../raids/tob/context';
import { CollapsiblePanel } from '../collapsible-panel/collapsible-panel';
import styles from './styles.module.scss';
import { PlayerAttack, Room } from '@blert/common/dist/raid-definitions';
import { Event, PlayerAttackEvent } from '@blert/common';

const getLigmaFromPlayerAttackEvent = (event: PlayerAttackEvent): string => {
  switch (event.attack.type) {
    case PlayerAttack.SCYTHE:
      return 'S';
    case PlayerAttack.BGS_SMACK:
      return '💩';
    case PlayerAttack.BGS_SPEC:
      return 'BGS';
    case PlayerAttack.BLOWPIPE:
      return 'BP';
    case PlayerAttack.CHALLY_SPEC:
      return 'Ch';
    case PlayerAttack.CHIN_BLACK:
      return '🦔';
    case PlayerAttack.CHIN_GREY:
      return '💩';
    case PlayerAttack.CHIN_RED:
      return '💩';
    case PlayerAttack.CLAW_SCRATCH:
      return '💩';
    case PlayerAttack.CLAW_SPEC:
      return '👋🏼';
    case PlayerAttack.DAWN_SPEC:
      return '🧙';
    case PlayerAttack.FANG:
      return '💩';
    case PlayerAttack.HAMMER_BOP:
      return '💩';
    case PlayerAttack.HAMMER_SPEC:
      return '🛡️';
    case PlayerAttack.HAM_JOINT:
      return '🐷';
    case PlayerAttack.KODAI_BARRAGE:
      return '🧊';
    case PlayerAttack.KODAI_BASH:
      return '💩';
    case PlayerAttack.SAELDOR:
      return '💩';
    case PlayerAttack.SANG:
      return '🩸';
    case PlayerAttack.SANG_BARRAGE:
      return '🧀';
    case PlayerAttack.SCEPTRE_BARRAGE:
      return '🧊';
    case PlayerAttack.SCYTHE:
      return 'S';
    case PlayerAttack.SCYTHE_UNCHARGED:
      return '💩';
    case PlayerAttack.SHADOW:
      return '💩';
    case PlayerAttack.SHADOW_BARRAGE:
      return '💩';
    case PlayerAttack.SWIFT:
      return '🏃‍♂️';
    case PlayerAttack.TENT_WHIP:
      return '💩';
    case PlayerAttack.TOXIC_TRIDENT:
      return '💩';
    case PlayerAttack.TOXIC_TRIDENT_BARRAGE:
      return '💩';
    case PlayerAttack.TOXIC_STAFF_BARRAGE:
      return '🐍';
    case PlayerAttack.TOXIC_STAFF_SWIPE:
      return '💩';
    case PlayerAttack.TRIDENT:
      return '💩';
    case PlayerAttack.TRIDENT_BARRAGE:
      return '💩';
    case PlayerAttack.TWISTED_BOW:
      return 'TB';
    case PlayerAttack.ZCB:
      return 'Z';
    default:
      return '';
  }
};

const buildTickCell = (event: Event) => {
  // @ts-ignore
  const attackedThisTick = event.attack !== undefined;

  let letterToDisplay: string = '';

  if (attackedThisTick) {
    letterToDisplay = getLigmaFromPlayerAttackEvent(event as PlayerAttackEvent);
  }

  return (
    <div
      className={styles.attackTimeline__Cell}
      key={`cell-${Math.floor(Math.random() * 100000)}`}
    >
      {letterToDisplay}
    </div>
  );
};

const buildTickColumn = (
  attackTimeline: Map<string, Event[]>,
  columnTick: number,
  currentPlaybackTick: number,
) => {
  const tickCells = [];
  const cellEvents = [];

  const allPlayersTimelines = Array.from(attackTimeline.values());

  for (let i = 0; i < allPlayersTimelines.length; i++) {
    const playerTimeline = allPlayersTimelines[i];

    for (let j = 0; j < playerTimeline.length; j++) {
      const event = playerTimeline[j];

      if (event.tick === columnTick) {
        cellEvents.push(event);
        break;
      }
    }
  }

  for (let i = 0; i < cellEvents.length; i++) {
    tickCells.push(buildTickCell(cellEvents[i]));
  }

  return (
    <div
      key={`attackTimeline__${columnTick}`}
      className={`${styles.attackTimeline__Column} ${currentPlaybackTick === columnTick ? styles.attackTimeline__ColumnActive : ''}`}
    >
      <div className={styles.attackTimeline__TickHeader}>{columnTick}</div>
      {tickCells}
    </div>
  );
};

interface AttackTimelineProps {
  currentTick: number;
  playing: boolean;
  attackTimelines: Map<string, Event[]>;
}

export function BossPageAttackTimeline(props: AttackTimelineProps) {
  const { currentTick, playing, attackTimelines } = props;

  console.log('attackTimelines', attackTimelines);

  const attackTimelineRef = useRef<HTMLDivElement>(null);

  const raidData = useContext(RaidContext);

  if (raidData === null) {
    return <>Loading...</>;
  }

  if (attackTimelineRef.current !== null) {
    if (playing) {
      if (currentTick * 75 < 525) {
        attackTimelineRef.current.scrollLeft = 0;
      } else {
        attackTimelineRef.current.scrollLeft = (currentTick - 1) * 75 - 380;
      }
    } else {
      if (currentTick * 75 < 525) {
        attackTimelineRef.current.scrollLeft = 0;
      }
    }
  }

  const { rooms } = raidData;
  const maiden = rooms[Room.MAIDEN];

  const numberOfAttackTimelineTicks = maiden!.roomTicks;

  const attackTimelineColumnElements = [];

  for (let i = 0; i < numberOfAttackTimelineTicks; i++) {
    const tick = i + 1;

    const bossEventsForTick = raidData.rooms[Room.MAIDEN]!;

    attackTimelineColumnElements.push(
      buildTickColumn(attackTimelines, tick, currentTick),
    );
  }

  return (
    <CollapsiblePanel
      panelTitle={'Tick Timeline'}
      maxPanelHeight={500}
      defaultExpanded={true}
      className={styles.attackTimeline}
    >
      <div className={styles.attackTimeline__Inner} ref={attackTimelineRef}>
        {attackTimelineColumnElements}
      </div>
    </CollapsiblePanel>
  );
}
