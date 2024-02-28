'use client';

import { useContext, useEffect, useRef } from 'react';
import {
  Attack,
  Event,
  NpcAttack,
  NpcAttackEvent,
  PlayerAttack,
  PlayerAttackEvent,
  PlayerUpdateEvent,
  Room,
  getNpcDefinition,
} from '@blert/common';
import Image from 'next/image';

import { RaidContext } from '../../raids/tob/context';
import { CollapsiblePanel } from '../collapsible-panel/collapsible-panel';
import Item from '../item';

import styles from './styles.module.scss';

const getCellImageForBossAttack = (attack: NpcAttack) => {
  let imageUrl = '';

  switch (attack) {
    case NpcAttack.MAIDEN_AUTO:
      imageUrl = '/maiden_auto.png';
      break;
    case NpcAttack.MAIDEN_BLOOD_THROW:
      imageUrl = '/maiden_blood_throw.png';
      break;
    default:
      imageUrl = '/huh.png';
      break;
  }

  return (
    <div className={styles.attackTimeline__CellImage}>
      <div className={styles.attackTimeline__CellImage__BossAtk}>
        <Image
          src={imageUrl}
          alt="Boss Attack - Maiden"
          fill
          style={{ objectFit: 'contain' }}
        />
      </div>
    </div>
  );
};

const makeCellImage = (playerAttack: Attack) => {
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

const buildTickCell = (event: Event | null) => {
  // @ts-ignore
  // console.log(event);

  if (event === null) {
    return (
      <div
        className={`${styles.attackTimeline__Cell}`}
        key={`boss-cooldown-cell`}
      >
        <span className={styles.attackTimeline__Nothing}></span>
      </div>
    );
  }

  // @ts-ignore
  if (event.npcAttack !== undefined) {
    let cellImage = getCellImageForBossAttack(
      (event as NpcAttackEvent).npcAttack.attack,
    );

    return (
      <div
        className={`${styles.attackTimeline__Cell} ${styles.attackTimeline__CellOffCooldown}`}
        key={`boss-cell-${event.tick}`}
      >
        {cellImage}
      </div>
    );
    // @ts-ignore
  } else if (event.player) {
    const playerIsOffCooldown =
      (event as PlayerUpdateEvent).player.offCooldownTick <= event.tick;

    // @ts-ignore
    const attackedThisTick = event.attack !== undefined;
    // @ts-ignore
    const diedThisTick = event.diedThisTick ?? false;
    // @ts-ignore
    const playerIsDead = event.isDead ?? false;

    let cellImage;

    if (attackedThisTick) {
      cellImage = makeCellImage((event as PlayerAttackEvent).attack);
    } else if (diedThisTick) {
      cellImage = (
        <div className={styles.attackTimeline__CellImage}>
          <div className={styles.attackTimeline__CellImage__BossAtk}>
            <Image
              src="/skull.webp"
              alt="Player died"
              fill
              style={{ objectFit: 'contain' }}
            />
          </div>
        </div>
      );
    } else {
      cellImage = <span className={styles.attackTimeline__Nothing}></span>;
    }

    let className = styles.attackTimeline__Cell;
    if (playerIsOffCooldown || diedThisTick) {
      className += ` ${styles.attackTimeline__CellOffCooldown}`;
    } else if (playerIsDead) {
      className += ` ${styles.cellDead}`;
    }

    return (
      <div
        className={className}
        key={`player-cell-${(event as PlayerUpdateEvent).player.name}-${event.tick}`}
      >
        {cellImage}
      </div>
    );
  }
};

const buildTickColumn = (
  bossAttackTimeline: NpcAttackEvent[],
  attackTimeline: Map<string, Event[]>,
  columnTick: number,
  currentPlaybackTick: number,
) => {
  const tickCells = [];
  const cellEvents = [];

  const allPlayersTimelines = Array.from(attackTimeline.values());

  for (let i = 0; i < bossAttackTimeline.length; i++) {
    const bossEvent = bossAttackTimeline[i];

    if (bossEvent.tick === columnTick) {
      cellEvents.push(bossEvent);
      break;
    }
  }

  if (cellEvents.length === 0) {
    cellEvents.push(null);
  }

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
  playerAttackTimelines: Map<string, Event[]>;
  bossAttackTimeline: NpcAttackEvent[];
}

export function BossPageAttackTimeline(props: AttackTimelineProps) {
  const { currentTick, playing, playerAttackTimelines, bossAttackTimeline } =
    props;

  let npcName = getNpcDefinition(bossAttackTimeline[0].npc.id)!.name;

  if (npcName.includes('The')) {
    npcName = 'Maiden';
  }

  const attackTimelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const div = attackTimelineRef.current;
    if (div === null) {
      return () => {};
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      div.scrollLeft += e.deltaY;
    };

    div.addEventListener('wheel', handleWheel, { passive: false });
    return () => div.removeEventListener('wheel', handleWheel);
  }, [attackTimelineRef.current]);

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

    attackTimelineColumnElements.push(
      buildTickColumn(
        bossAttackTimeline,
        playerAttackTimelines,
        tick,
        currentTick,
      ),
    );
  }

  const attackTimelineParticipants = [
    npcName,
    ...Array.from(playerAttackTimelines.keys()),
  ];

  const attackTLLegendElements = [];

  for (let i = 0; i < attackTimelineParticipants.length; i++) {
    attackTLLegendElements.push(
      <div
        className={styles.attackTimeline__LegendParticipant}
        key={`attack-tl-participant-${attackTimelineParticipants[i]}`}
      >
        {attackTimelineParticipants[i]}
      </div>,
    );
  }

  console.log('Attack timeline participants', attackTimelineParticipants);

  return (
    <CollapsiblePanel
      panelTitle={'Tick Timeline'}
      maxPanelHeight={500}
      defaultExpanded={true}
      className={styles.attackTimeline}
    >
      <div className={styles.attackTimeline__Inner}>
        <div className={styles.attackTimeline__Legend}>
          {attackTLLegendElements}
        </div>
        <div
          className={styles.attackTimeline__Scrollable}
          ref={attackTimelineRef}
        >
          {attackTimelineColumnElements}
        </div>
      </div>
    </CollapsiblePanel>
  );
}
