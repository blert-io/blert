'use client';

import { useContext, useRef } from 'react';
import {
  Attack,
  Event,
  PlayerAttack,
  PlayerAttackEvent,
  PlayerUpdateEvent,
  Room,
} from '@blert/common';

import { RaidContext } from '../../raids/tob/context';
import { CollapsiblePanel } from '../collapsible-panel/collapsible-panel';
import Item from '../item';

import styles from './styles.module.scss';

const makeCellImage = (playerAttack: Attack, playerIsOffCooldown: boolean) => {
  let infoIcon;

  switch (playerAttack.type) {
    case PlayerAttack.BGS_SMACK:
      infoIcon = <span className={styles.ligma}></span>;
      break;
  }

  return (
    <div className={styles.attackTimeline__CellImage}>
      <Item name={playerAttack.weapon.name} quantity={1} />
    </div>
  );
};

const FUCKING_MAGIC = 55;

const buildTickCell = (event: Event) => {
  const playerIsOffCooldown =
    (event as PlayerUpdateEvent).player.offCooldownTick <= event.tick;

  // @ts-ignore
  const attackedThisTick = event.attack !== undefined;

  let cellImage;

  if (attackedThisTick) {
    cellImage = makeCellImage(
      (event as PlayerAttackEvent).attack,
      playerIsOffCooldown,
    );
  } else {
    cellImage = <span className={styles.attackTimeline__Nothing}></span>;
  }

  return (
    <div
      className={`${styles.attackTimeline__Cell} ${playerIsOffCooldown && styles.attackTimeline__CellOffCooldown}`}
      key={`cell-${Math.floor(Math.random() * 1000000)}`}
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
      className={styles.attackTimeline__Column}
    >
      {currentPlaybackTick === columnTick && (
        <div className={styles.attackTimeline__ColumnActiveIndicator}></div>
      )}
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
      if (currentTick * FUCKING_MAGIC < 525) {
        attackTimelineRef.current.scrollLeft = 0;
      } else {
        attackTimelineRef.current.scrollLeft =
          (currentTick - 1) * FUCKING_MAGIC - 380;
      }
    } else {
      if (currentTick * FUCKING_MAGIC < 525) {
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
