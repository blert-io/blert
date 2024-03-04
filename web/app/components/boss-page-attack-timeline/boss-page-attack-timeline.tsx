'use client';

import { useEffect, useRef } from 'react';
import {
  Attack,
  Event,
  NpcAttack,
  NpcAttackEvent,
  PlayerAttack,
  PlayerAttackEvent,
  PlayerUpdateEvent,
  getNpcDefinition,
} from '@blert/common';
import Image from 'next/image';

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
    case NpcAttack.NYLO_BOSS_MELEE:
      imageUrl = '/nylo_boss_melee.png';
      break;
    case NpcAttack.NYLO_BOSS_RANGE:
      imageUrl = '/nylo_boss_range.png';
      break;
    case NpcAttack.NYLO_BOSS_MAGE:
      imageUrl = '/nylo_boss_mage.png';
      break;
    case NpcAttack.SOTE_BALL:
      imageUrl = '/sote_ball.png';
      break;
    case NpcAttack.SOTE_MELEE:
      imageUrl = '/sote_melee.png';
      break;
    case NpcAttack.SOTE_DEATH_BALL:
      imageUrl = '/sote_death_ball.png';
      break;
    case NpcAttack.XARPUS_SPIT:
      imageUrl = '/xarpus_spit.png';
      break;
    case NpcAttack.XARPUS_TURN:
      imageUrl = '/xarpus_turn.webp';
      break;
    case NpcAttack.VERZIK_P1_AUTO:
      imageUrl = '/verzik_p1_auto.png';
      break;
    case NpcAttack.VERZIK_P2_BOUNCE:
      imageUrl = '/verzik_p2_bounce.png';
      break;
    case NpcAttack.VERZIK_P2_CABBAGE:
      imageUrl = '/verzik_p2_cabbage.png';
      break;
    case NpcAttack.VERZIK_P2_PURPLE:
      imageUrl = '/verzik_p2_purple.png';
      break;
    case NpcAttack.VERZIK_P2_ZAP:
      imageUrl = '/verzik_p2_zap.png';
      break;
    case NpcAttack.VERZIK_P3_WEBS:
      imageUrl = '/verzik_p3_webs.png';
      break;
    case NpcAttack.VERZIK_P3_MELEE:
      imageUrl = '/verzik_p3_melee.png';
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
          alt={`Boss Attack: ${attack}`}
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
  let blunderIcon;

  switch (true) {
    case true:
      blunderIcon = (
        <Image
          className={styles.attackTimeline__CellImage__blunderIcon}
          src={'/spec.png'}
          alt="Special Attack"
          height={25}
          width={25}
        />
      );
      break;
  }

  let infoIcon;

  switch (playerAttack.type) {
    case PlayerAttack.BGS_SPEC:
    case PlayerAttack.HAMMER_SPEC:
    case PlayerAttack.CHALLY_SPEC:
    case PlayerAttack.DAWN_SPEC:
    case PlayerAttack.DINHS_SPEC:
    case PlayerAttack.CLAW_SPEC:
    case PlayerAttack.HAMMER_SPEC:
    case PlayerAttack.HAMMER_SPEC:
      infoIcon = (
        <Image
          className={styles.attackTimeline__CellImage__InfoIcon}
          src={'/spec.png'}
          alt="Special Attack"
          height={25}
          width={25}
        />
      );
      break;
    case PlayerAttack.SANG_BARRAGE:
    case PlayerAttack.SHADOW_BARRAGE:
    case PlayerAttack.STAFF_OF_LIGHT_BARRAGE:
    case PlayerAttack.TOXIC_TRIDENT_BARRAGE:
    case PlayerAttack.TOXIC_STAFF_BARRAGE:
    case PlayerAttack.TRIDENT_BARRAGE:
    case PlayerAttack.KODAI_BARRAGE:
    case PlayerAttack.SCEPTRE_BARRAGE:
    case PlayerAttack.UNKNOWN_BARRAGE:
      infoIcon = (
        <Image
          className={styles.attackTimeline__CellImage__InfoIcon}
          src={'/barrage.png'}
          alt="Barrage"
          height={25}
          width={25}
        />
      );
      break;
  }

  let outline = inventoryTags
    ? inventoryTagColor(playerAttack.type)
    : undefined;

  return (
    <div className={styles.attackTimeline__CellImage}>
      {infoIcon && infoIcon}
      {(playerAttack.weapon && (
        <Item
          name={playerAttack.weapon.name}
          quantity={1}
          outlineColor={outline}
        />
      )) || (
        <div className={styles.attackTimeline__CellImage__BossAtk}>
          <Image
            src="/huh.png"
            alt="Unknown attack"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
      )}
    </div>
  );
};

const FUCKING_MAGIC = 55;

const buildTickCell = (
  event: Event | null,
  tick: number,
  actorIndex: number,
  inventoryTags: boolean,
) => {
  // @ts-ignore

  if (event === null) {
    return (
      <div
        className={`${styles.attackTimeline__Cell}`}
        key={`empty-cell-${tick}-${actorIndex}`}
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
        className={`${styles.attackTimeline__Cell} ${styles.attackTimeline__BossCooldown}`}
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
  updateTickOnPage: (tick: number) => void,
  inventoryTags: boolean,
) => {
  const tickCells = [];
  const cellEvents = [];

  const allPlayersTimelines = Array.from(attackTimeline.values());

  const bossEvent = bossAttackTimeline.findLast(
    (event) => event.tick === columnTick,
  );
  cellEvents.push(bossEvent ?? null);

  for (let i = 0; i < allPlayersTimelines.length; i++) {
    const playerTimeline = allPlayersTimelines[i];
    const event = playerTimeline.find((event) => event.tick === columnTick);
    cellEvents.push(event ?? null);
  }

  for (let i = 0; i < cellEvents.length; i++) {
    tickCells.push(buildTickCell(cellEvents[i], columnTick, i, inventoryTags));
  }

  return (
    <div
      key={`attackTimeline__${columnTick}`}
      className={styles.attackTimeline__Column}
    >
      {currentPlaybackTick === columnTick && (
        <div className={styles.attackTimeline__ColumnActiveIndicator}></div>
      )}
      <button
        className={styles.attackTimeline__TickHeader}
        onClick={() => updateTickOnPage(columnTick)}
      >
        {columnTick}
      </button>
      {tickCells}
    </div>
  );
};

interface AttackTimelineProps {
  currentTick: number;
  playing: boolean;
  playerAttackTimelines: Map<string, Event[]>;
  bossAttackTimeline: NpcAttackEvent[];
  timelineTicks: number;
  inventoryTags?: boolean;
  updateTickOnPage: (tick: number) => void;
}

export function BossPageAttackTimeline(props: AttackTimelineProps) {
  const {
    currentTick,
    playing,
    playerAttackTimelines,
    bossAttackTimeline,
    updateTickOnPage,
    timelineTicks,
  } = props;

  const inventoryTags = props.inventoryTags ?? false;

  const nextBossAttackNpcId =
    bossAttackTimeline.find((evt) => evt.tick > currentTick)?.npc.id ?? 0;
  const npcName = getNpcDefinition(nextBossAttackNpcId)?.shortName ?? 'Unknown';

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

  const attackTimelineColumnElements = [];

  for (let i = 0; i < timelineTicks; i++) {
    const tick = i + 1;

    attackTimelineColumnElements.push(
      buildTickColumn(
        bossAttackTimeline,
        playerAttackTimelines,
        tick,
        currentTick,
        updateTickOnPage,
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
        className={`${styles.attackTimeline__LegendParticipant}${i === 0 ? ` ${styles.attackTimeline__LegendParticipant__Boss}` : ''}`}
        key={`attack-tl-participant-${attackTimelineParticipants[i]}`}
      >
        {attackTimelineParticipants[i]}
      </div>,
    );
  }

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
