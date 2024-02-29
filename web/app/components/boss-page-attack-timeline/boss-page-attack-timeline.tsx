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

function inventoryTagColor(playerAttack: PlayerAttack): string | undefined {
  switch (playerAttack) {
    case PlayerAttack.SCYTHE:
    case PlayerAttack.SCYTHE_UNCHARGED:
    case PlayerAttack.FANG:
    case PlayerAttack.HAM_JOINT:
    case PlayerAttack.SAELDOR:
    case PlayerAttack.SWIFT:
    case PlayerAttack.TENT_WHIP:
      return 'red';

    case PlayerAttack.BLOWPIPE:
    case PlayerAttack.CHIN_BLACK:
    case PlayerAttack.CHIN_GREY:
    case PlayerAttack.CHIN_RED:
    case PlayerAttack.TWISTED_BOW:
    case PlayerAttack.ZCB:
      return 'green';

    case PlayerAttack.BGS_SMACK:
    case PlayerAttack.BGS_SPEC:
    case PlayerAttack.CHALLY_SPEC:
    case PlayerAttack.CLAW_SCRATCH:
    case PlayerAttack.CLAW_SPEC:
    case PlayerAttack.DAWN_SPEC:
    case PlayerAttack.DINHS_SPEC:
    case PlayerAttack.HAMMER_BOP:
    case PlayerAttack.HAMMER_SPEC:
      return 'yellow';

    case PlayerAttack.KODAI_BARRAGE:
    case PlayerAttack.KODAI_BASH:
    case PlayerAttack.SANG:
    case PlayerAttack.SANG_BARRAGE:
    case PlayerAttack.SCEPTRE_BARRAGE:
    case PlayerAttack.SHADOW:
    case PlayerAttack.SHADOW_BARRAGE:
    case PlayerAttack.STAFF_OF_LIGHT_BARRAGE:
    case PlayerAttack.STAFF_OF_LIGHT_SWIPE:
    case PlayerAttack.TOXIC_TRIDENT:
    case PlayerAttack.TOXIC_TRIDENT_BARRAGE:
    case PlayerAttack.TOXIC_STAFF_BARRAGE:
    case PlayerAttack.TOXIC_STAFF_SWIPE:
    case PlayerAttack.TRIDENT:
    case PlayerAttack.TRIDENT_BARRAGE:
      return 'blue';
  }
  return undefined;
}

const makeCellImage = (playerAttack: Attack, inventoryTags: boolean) => {
  let infoIcon;

  switch (playerAttack.type) {
    case PlayerAttack.BGS_SMACK:
      infoIcon = <span className={styles.ligma}></span>;
      break;
  }

  let outline = inventoryTags
    ? inventoryTagColor(playerAttack.type)
    : undefined;

  return (
    <div className={styles.attackTimeline__CellImage}>
      <Item
        name={playerAttack.weapon.name}
        quantity={1}
        outlineColor={outline}
      />
    </div>
  );
};

const FUCKING_MAGIC = 55;

const buildTickCell = (event: Event | null, inventoryTags: boolean) => {
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
      cellImage = makeCellImage(
        (event as PlayerAttackEvent).attack,
        inventoryTags,
      );
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
  inventoryTags: boolean,
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
    tickCells.push(buildTickCell(cellEvents[i], inventoryTags));
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
  inventoryTags?: boolean;
}

export function BossPageAttackTimeline(props: AttackTimelineProps) {
  const { currentTick, playing, playerAttackTimelines, bossAttackTimeline } =
    props;

  const inventoryTags = props.inventoryTags ?? false;

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
        inventoryTags,
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
