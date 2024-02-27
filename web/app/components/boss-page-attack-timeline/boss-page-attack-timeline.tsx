'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { RaidContext } from '../../raids/tob/context';
import { CollapsiblePanel } from '../collapsible-panel/collapsible-panel';
import styles from './styles.module.scss';
import { PlayerAttack, Room } from '@blert/common/raid-definitions';
import { Event, PlayerAttackEvent } from '@blert/common';
import Item from '../item';
import { Attack } from '@blert/common/event';

const makeCellImage = (playerAttack: Attack) => {
  let weaponImage;
  let infoIcon;

  switch (playerAttack) {
    default:
  }

  return (
    <span className={styles.attackTimeline__CellImage}>
      <h2>
        <Item name={playerAttack.weapon.name} quantity={1} />
      </h2>
    </span>
  );
};

const buildTickCell = (event: Event) => {
  // @ts-ignore
  const attackedThisTick = event.attack !== undefined;

  let cellImage;

  if ((event as PlayerAttackEvent).attack) {
    cellImage = attackedThisTick ? (
      makeCellImage((event as PlayerAttackEvent).attack)
    ) : (
      <></>
    );
  }

  return (
    <div
      className={styles.attackTimeline__Cell}
      key={`cell-${Math.floor(Math.random() * 100000)}`}
    >
      {cellImage}
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

      if (event?.tick === columnTick) {
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
