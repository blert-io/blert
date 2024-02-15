'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { RaidContext } from '../../raids/tob/context';
import { CollapsiblePanel } from '../collapsible-panel/collapsible-panel';
import styles from './styles.module.scss';
import { Room } from '@blert/common/dist/raid-definitions';
import { loadEventsForRoom } from '../../actions/raid';
import { Event } from '@blert/common';

const buildTickCell = () => {
  return (
    <div
      className={styles.attackTimeline__Cell}
      key={`cell-${Math.floor(Math.random() * 100000)}`}
    ></div>
  );
};

const buildTickColumn = (columnTick: number, currentPlaybackTick: number) => {
  const tickCells = [];
  for (let i = 0; i < 4; i++) {
    tickCells.push(buildTickCell());
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
  roomEvents: Event[];
}

export function BossPageAttackTimeline(props: AttackTimelineProps) {
  const { currentTick, playing, roomEvents } = props;

  const attackTimelineRef = useRef<HTMLDivElement>(null);

  console.warn('@@@', roomEvents);

  const raidData = useContext(RaidContext);

  if (raidData === null || roomEvents.length === 0 || roomEvents == null) {
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

    attackTimelineColumnElements.push(buildTickColumn(tick, currentTick));
  }

  return (
    <CollapsiblePanel
      panelTitle={'Tick Timeline'}
      maxPanelHeight={500}
      defaultExpanded={true}
      className={styles.attackTimeline}
    >
      <div className={styles.attackTimeline__Inner} ref={attackTimelineRef}>
        <div
          className={styles.attackTimeline__ColumnActiveIndicator}
          style={{ left: currentTick * 75 - 57 }}
        ></div>
        {attackTimelineColumnElements}
      </div>
    </CollapsiblePanel>
  );
}
