'use client';

import {
  Attack,
  Event,
  NpcAttack,
  NpcAttackEvent,
  PlayerAttack,
  PlayerAttackEvent,
  PlayerUpdateEvent,
  RoomNpcMap,
  getNpcDefinition,
  npcFriendlyName,
} from '@blert/common';
import Image from 'next/image';
import { SetStateAction, useContext, useEffect, useMemo, useRef } from 'react';

import { CollapsiblePanel } from '../collapsible-panel/collapsible-panel';
import Item from '../item';
import { LigmaTooltip } from '../ligma-tooltip/ligma-tooltip';
import { BlertMemes, MemeContext } from '../../raids/meme-context';
import { ActorContext, RoomActorState } from '../../raids/tob/context';

import styles from './styles.module.scss';

const CELL_WIDTH = 50;
const COLUMN_MARGIN = 5;
const TOTAL_COLUMN_WIDTH = CELL_WIDTH + COLUMN_MARGIN;

const getCellImageForBossAttack = (attack: NpcAttack) => {
  let imageUrl = '';

  switch (attack) {
    case NpcAttack.MAIDEN_AUTO:
      imageUrl = '/maiden_auto.png';
      break;
    case NpcAttack.MAIDEN_BLOOD_THROW:
      imageUrl = '/maiden_blood_throw.png';
      break;
    case NpcAttack.BLOAT_STOMP:
      imageUrl = '/bloat_stomp.webp';
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
    case NpcAttack.VERZIK_P2_MAGE:
      imageUrl = '/verzik_p2_mage.webp';
      break;
    case NpcAttack.VERZIK_P3_WEBS:
      imageUrl = '/verzik_p3_webs.webp';
      break;
    case NpcAttack.VERZIK_P3_MELEE:
      imageUrl = '/verzik_p3_melee.webp';
      break;
    case NpcAttack.VERZIK_P3_RANGE:
      imageUrl = '/verzik_p3_range.webp';
      break;
    case NpcAttack.VERZIK_P3_MAGE:
      imageUrl = '/verzik_p3_mage.webp';
      break;
    case NpcAttack.VERZIK_P3_YELLOWS:
      imageUrl = '/verzik_p3_yellow.webp';
      break;
    case NpcAttack.VERZIK_P3_BALL:
      imageUrl = '/verzik_p3_ball.webp';
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

const ATTACK_MEMES = {
  [PlayerAttack.BGS_SMACK]: {
    tagColor: 'yellow',
    letter: 'bg',
  },
  [PlayerAttack.BGS_SPEC]: {
    tagColor: 'yellow',
    letter: 'BGS',
  },
  [PlayerAttack.BLOWPIPE]: {
    tagColor: 'green',
    letter: 'BP',
  },
  [PlayerAttack.CHALLY_SPEC]: {
    tagColor: 'yellow',
    letter: 'CH',
  },
  [PlayerAttack.CHIN_BLACK]: {
    tagColor: 'green',
    letter: 'CCB',
  },
  [PlayerAttack.CHIN_GREY]: {
    tagColor: 'green',
    letter: 'CCG',
  },
  [PlayerAttack.CHIN_RED]: {
    tagColor: 'green',
    letter: 'CCR',
  },
  [PlayerAttack.CLAW_SCRATCH]: {
    tagColor: 'red',
    letter: 'c',
  },
  [PlayerAttack.CLAW_SPEC]: {
    tagColor: 'red',
    letter: 'C',
  },
  [PlayerAttack.DAWN_SPEC]: {
    tagColor: 'yellow',
    letter: 'DB',
  },
  [PlayerAttack.DINHS_SPEC]: {
    tagColor: 'yellow',
    letter: 'BW',
  },
  [PlayerAttack.FANG]: {
    tagColor: 'red',
    letter: 'FNG',
  },
  [PlayerAttack.HAMMER_BOP]: {
    tagColor: 'red',
    letter: 'h',
  },
  [PlayerAttack.HAMMER_SPEC]: {
    tagColor: 'red',
    letter: 'H',
  },
  [PlayerAttack.KODAI_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
  },
  [PlayerAttack.KODAI_BASH]: {
    tagColor: 'blue',
    letter: 'kb',
  },
  [PlayerAttack.RAPIER]: {
    tagColor: 'red',
    letter: 'R',
  },
  [PlayerAttack.SAELDOR]: {
    tagColor: 'red',
    letter: 'B',
  },
  [PlayerAttack.SANG]: {
    tagColor: 'blue',
    letter: 'T',
  },
  [PlayerAttack.SANG_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
  },
  [PlayerAttack.SCEPTRE_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
  },
  [PlayerAttack.SHADOW]: {
    tagColor: 'blue',
    letter: 'Sh',
  },
  [PlayerAttack.SHADOW_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
  },
  [PlayerAttack.STAFF_OF_LIGHT_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
  },
  [PlayerAttack.STAFF_OF_LIGHT_SWIPE]: {
    tagColor: 'blue',
    letter: 'SOL',
  },
  [PlayerAttack.TENT_WHIP]: {
    tagColor: 'red',
    letter: 'TW',
  },
  [PlayerAttack.TOXIC_TRIDENT]: {
    tagColor: 'blue',
    letter: 'T',
  },
  [PlayerAttack.TOXIC_TRIDENT_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
  },
  [PlayerAttack.TOXIC_STAFF_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
  },
  [PlayerAttack.TOXIC_STAFF_SWIPE]: {
    tagColor: 'blue',
    letter: 'TS',
  },
  [PlayerAttack.TRIDENT]: {
    tagColor: 'blue',
    letter: 'T',
  },
  [PlayerAttack.TRIDENT_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
  },
  [PlayerAttack.TWISTED_BOW]: {
    tagColor: 'green',
    letter: 'TB',
  },
  [PlayerAttack.ZCB]: {
    tagColor: 'green',
    letter: 'ZC',
  },
  [PlayerAttack.SCYTHE]: {
    tagColor: 'red',
    letter: 'S',
  },
  [PlayerAttack.SCYTHE_UNCHARGED]: {
    tagColor: 'red',
    letter: 's',
  },
  [PlayerAttack.HAM_JOINT]: {
    tagColor: 'red',
    letter: 'SB',
  },
  [PlayerAttack.SOULREAPER_AXE]: {
    tagColor: 'red',
    letter: 'AXE',
  },
  [PlayerAttack.SWIFT]: {
    tagColor: 'red',
    letter: 'SB',
  },
  [PlayerAttack.VOLATILE_NM_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
  },
  [PlayerAttack.UNKNOWN_BARRAGE]: {
    tagColor: undefined,
    letter: 'F',
  },
  [PlayerAttack.UNKNOWN_BOW]: {
    tagColor: undefined,
    letter: 'UNK',
  },
  [PlayerAttack.UNKNOWN]: {
    tagColor: undefined,
    letter: 'UNK',
  },
};

const makeCellImage = (playerAttack: Attack, memes: BlertMemes) => {
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

  let content;

  if (!memes.capsLock) {
    let infoIcon = undefined;

    const trollStyles = {
      filter: 'drop-shadow(2px 4px 6px black)',
      transform: 'rotate(267deg) skewX(3.78rad)',
    };
    let troll = false;

    switch (playerAttack.type) {
      case PlayerAttack.BGS_SPEC:
      case PlayerAttack.HAMMER_SPEC:
      case PlayerAttack.CHALLY_SPEC:
      case PlayerAttack.DAWN_SPEC:
      case PlayerAttack.DINHS_SPEC:
      case PlayerAttack.CLAW_SPEC:
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
      case PlayerAttack.VOLATILE_NM_BARRAGE:
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
      case PlayerAttack.BGS_SMACK:
      case PlayerAttack.HAMMER_BOP:
        troll = true;
        break;
    }

    let outline = memes.inventoryTags
      ? ATTACK_MEMES[playerAttack.type].tagColor
      : undefined;

    content = (
      <>
        {infoIcon && infoIcon}
        {(playerAttack.weapon && (
          <Item
            name={playerAttack.weapon.name}
            quantity={1}
            outlineColor={outline}
            style={troll ? trollStyles : undefined}
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
      </>
    );
  } else {
    // In caps lock mode, only use letters.
    const letter = ATTACK_MEMES[playerAttack.type].letter ?? 'UNK';
    content = <div className={styles.letter}>{letter}</div>;
  }

  return <div className={styles.attackTimeline__CellImage}>{content}</div>;
};

const bossAttackName = (attack: NpcAttack): string => {
  // A human-readable name for the attack, to be used to complete the sentence
  // "X targeted Y with ..." or "X did ..."
  switch (attack) {
    case NpcAttack.MAIDEN_AUTO:
    case NpcAttack.VERZIK_P1_AUTO:
      return 'an auto attack';

    case NpcAttack.MAIDEN_BLOOD_THROW:
      return 'a blood throw';

    case NpcAttack.BLOAT_STOMP:
      return 'a stomp';

    case NpcAttack.NYLO_BOSS_MELEE:
    case NpcAttack.SOTE_MELEE:
    case NpcAttack.VERZIK_P3_MELEE:
      return 'a melee attack';

    case NpcAttack.NYLO_BOSS_RANGE:
    case NpcAttack.VERZIK_P2_CABBAGE:
    case NpcAttack.VERZIK_P3_RANGE:
      return 'a ranged attack';

    case NpcAttack.NYLO_BOSS_MAGE:
    case NpcAttack.VERZIK_P3_MAGE:
    case NpcAttack.VERZIK_P2_MAGE:
      return 'a magic attack';

    case NpcAttack.SOTE_BALL:
      return 'a ball';

    case NpcAttack.SOTE_DEATH_BALL:
      return 'a death ball';

    case NpcAttack.XARPUS_SPIT:
      return 'a poison spit';

    case NpcAttack.XARPUS_TURN:
      return 'a turn';

    case NpcAttack.VERZIK_P2_BOUNCE:
      return 'a bounce';

    case NpcAttack.VERZIK_P2_ZAP:
      return 'a zap';

    case NpcAttack.VERZIK_P2_PURPLE:
      return 'a purple crab';

    case NpcAttack.VERZIK_P3_AUTO:
      return 'an unknown attack';

    case NpcAttack.VERZIK_P3_WEBS:
      return 'webs';

    case NpcAttack.VERZIK_P3_YELLOWS:
      return 'yellow pools';

    case NpcAttack.VERZIK_P3_BALL:
      return 'a green ball';
  }

  return '';
};

const playerAttackVerb = (attack: PlayerAttack): string => {
  switch (attack) {
    case PlayerAttack.BGS_SMACK:
      return 'smacked';
    case PlayerAttack.BGS_SPEC:
      return "BGS'd";
    case PlayerAttack.BLOWPIPE:
      return 'piped';
    case PlayerAttack.CHALLY_SPEC:
      return 'challied';
    case PlayerAttack.CHIN_BLACK:
    case PlayerAttack.CHIN_GREY:
    case PlayerAttack.CHIN_RED:
      return 'chinned';
    case PlayerAttack.CLAW_SCRATCH:
      return 'claw scratched';
    case PlayerAttack.CLAW_SPEC:
      return 'clawed';
    case PlayerAttack.DAWN_SPEC:
      return 'dawned';
    case PlayerAttack.DINHS_SPEC:
      return 'dinhsed';
    case PlayerAttack.FANG:
      return 'fanged';
    case PlayerAttack.HAMMER_BOP:
      return 'hammer bopped';
    case PlayerAttack.HAMMER_SPEC:
      return 'hammered';
    case PlayerAttack.HAM_JOINT:
      return 'hammed';
    case PlayerAttack.KODAI_BARRAGE:
    case PlayerAttack.SANG_BARRAGE:
    case PlayerAttack.SCEPTRE_BARRAGE:
    case PlayerAttack.SHADOW_BARRAGE:
    case PlayerAttack.STAFF_OF_LIGHT_BARRAGE:
    case PlayerAttack.TOXIC_TRIDENT_BARRAGE:
    case PlayerAttack.TOXIC_STAFF_BARRAGE:
    case PlayerAttack.TRIDENT_BARRAGE:
    case PlayerAttack.VOLATILE_NM_BARRAGE:
    case PlayerAttack.UNKNOWN_BARRAGE:
      return 'froze';
    case PlayerAttack.KODAI_BASH:
      return 'kodai bashed';
    case PlayerAttack.RAPIER:
      return 'stabbed';
    case PlayerAttack.SAELDOR:
      return 'slashed';
    case PlayerAttack.SANG:
      return 'sanged';
    case PlayerAttack.SCYTHE:
    case PlayerAttack.SCYTHE_UNCHARGED:
      return 'scythed';
    case PlayerAttack.SHADOW:
      return 'shadowed';
    case PlayerAttack.SOULREAPER_AXE:
      return 'cleaved';
    case PlayerAttack.STAFF_OF_LIGHT_SWIPE:
    case PlayerAttack.TOXIC_STAFF_SWIPE:
      return 'swiped';
    case PlayerAttack.SWIFT:
      return 'swifted';
    case PlayerAttack.TENT_WHIP:
      return 'whipped';
    case PlayerAttack.TWISTED_BOW:
    case PlayerAttack.UNKNOWN_BOW:
      return 'bowed';
    case PlayerAttack.ZCB:
      return "ZCB'd";
    case PlayerAttack.TOXIC_TRIDENT:
    case PlayerAttack.TRIDENT:
    case PlayerAttack.UNKNOWN:
      return 'attacked';
  }

  return 'attacked';
};

type CellInfo = {
  event: Event | null;
  highlighted: boolean;
  backgroundColor?: string;
};

const buildTickCell = (
  cellInfo: CellInfo,
  tick: number,
  actorIndex: number,
  npcs: RoomNpcMap,
  actorContext: RoomActorState,
  memes: BlertMemes,
) => {
  const { setSelectedPlayer } = actorContext;
  let { event, highlighted, backgroundColor } = cellInfo;

  const style: React.CSSProperties = {
    backgroundColor,
    width: CELL_WIDTH,
    height: CELL_WIDTH,
  };

  if (event === null) {
    return (
      <div
        className={`${styles.attackTimeline__Cell}`}
        key={`empty-cell-${tick}-${actorIndex}`}
        style={style}
      >
        <span className={styles.attackTimeline__Nothing}></span>
      </div>
    );
  }

  let tooltip = undefined;
  let tooltipId = undefined;

  // @ts-ignore
  if (event.npcAttack !== undefined) {
    const npc = (event as NpcAttackEvent).npc;
    const npcAttack = (event as NpcAttackEvent).npcAttack;
    let cellImage = getCellImageForBossAttack(npcAttack.attack);

    const npcName = getNpcDefinition(npc.id)?.fullName ?? 'Unknown';

    tooltipId = `boss-attack-${event.tick}`;
    tooltip = (
      <LigmaTooltip tooltipId={tooltipId}>
        <div className={styles.bossTooltip}>
          <button>{npcName}</button>
          {(npcAttack.target !== undefined && (
            <span>
              targeted
              <button onClick={() => setSelectedPlayer(npcAttack.target!)}>
                {npcAttack.target}
              </button>
              with
            </span>
          )) || <span>did</span>}
          <span className={styles.bossAttack}>
            {bossAttackName(npcAttack.attack)}
          </span>
        </div>
      </LigmaTooltip>
    );

    const className =
      `${styles.attackTimeline__Cell} ` +
      `${styles.attackTimeline__BossCooldown} ${styles.cellInteractable}`;

    return (
      <div
        className={className}
        key={`boss-cell-${event.tick}`}
        data-tooltip-id={tooltipId}
        style={style}
      >
        {cellImage}
        {tooltip}
      </div>
    );
    // @ts-ignore
  } else if (event.player) {
    const username = (event as PlayerUpdateEvent).player.name;
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
      const attackEvent = event as PlayerAttackEvent;
      cellImage = makeCellImage(attackEvent.attack, memes);

      let targetName = 'Unknown';
      const maybeTarget = attackEvent.attack.target;
      if (maybeTarget !== undefined) {
        const roomNpc = npcs[maybeTarget.roomId];
        if (roomNpc !== undefined) {
          targetName = npcFriendlyName(roomNpc);
        }
      }

      tooltipId = `player-${username}-attack-${event.tick}`;

      tooltip = (
        <LigmaTooltip tooltipId={tooltipId}>
          <div className={styles.playerTooltip}>
            <button onClick={() => setSelectedPlayer(username)}>
              {username}
            </button>
            <span>{playerAttackVerb(attackEvent.attack.type)}</span>
            <button>{targetName}</button>
          </div>
        </LigmaTooltip>
      );
    } else if (diedThisTick) {
      tooltipId = `player-${username}-death`;

      tooltip = (
        <LigmaTooltip tooltipId={tooltipId}>
          <div className={styles.playerTooltip}>
            <button onClick={() => setSelectedPlayer(username)}>
              {username}
            </button>
            <span>died</span>
          </div>
        </LigmaTooltip>
      );

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
    if (tooltip !== undefined) {
      className += ` ${styles.cellInteractable}`;
    }
    if (playerIsOffCooldown || diedThisTick) {
      className += ` ${styles.attackTimeline__CellOffCooldown}`;
    } else if (playerIsDead) {
      className += ` ${styles.cellDead}`;
      style.backgroundColor = undefined;
    }

    return (
      <div
        className={className}
        style={style}
        data-tooltip-id={tooltipId}
        key={`player-cell-${(event as PlayerUpdateEvent).player.name}-${event.tick}`}
      >
        {cellImage}
        {tooltip}
      </div>
    );
  }
};

const buildTickColumn = (
  bossAttackTimeline: NpcAttackEvent[],
  attackTimeline: Map<string, Event[]>,
  columnTick: number,
  updateTickOnPage: (tick: number) => void,
  npcs: RoomNpcMap,
  actorContext: RoomActorState,
  memes: BlertMemes,
  split?: TimelineSplit,
  backgroundColor?: string,
) => {
  const tickCells = [];
  const cellInfo: CellInfo[] = [];

  const { selectedPlayer } = actorContext;

  const bossEvent = bossAttackTimeline.find(
    (event) => event.tick === columnTick,
  );
  cellInfo.push({
    event: bossEvent ?? null,
    highlighted: false,
    backgroundColor,
  });

  attackTimeline.forEach((playerTimeline, playerName) => {
    const event = playerTimeline.find((event) => event?.tick === columnTick);
    cellInfo.push({
      event: event ?? null,
      highlighted: selectedPlayer === playerName,
      backgroundColor,
    });
  });

  for (let i = 0; i < cellInfo.length; i++) {
    tickCells.push(
      buildTickCell(cellInfo[i], columnTick, i, npcs, actorContext, memes),
    );
  }

  const tooltipId = `atk-timeline-split-${split?.splitName}-tooltip`;

  return (
    <div
      key={`attackTimeline__${columnTick}`}
      className={styles.attackTimeline__Column}
      style={{ width: CELL_WIDTH, marginRight: COLUMN_MARGIN }}
    >
      {split !== undefined && (
        <div className={styles.attackTimeline__RoomSplit}>
          <LigmaTooltip openOnClick tooltipId={tooltipId}>
            {split.splitName}
          </LigmaTooltip>
          <span data-tooltip-id={tooltipId}>{split.splitName}</span>
          <div className={styles.splitIndicatorWrapper}>
            <div className={styles.splitIndicatorPt1}></div>
            <div className={styles.splitIndicatorPt2}></div>
          </div>
        </div>
      )}
      <button
        className={styles.attackTimeline__TickHeader}
        onClick={() => updateTickOnPage(columnTick)}
      >
        {columnTick}
      </button>
      {tickCells}
      {split !== undefined && (
        <div
          className={`${styles.attackTimeline__RoomSplit} ${styles.splitIndicatorBottom}`}
        >
          <div className={styles.splitIndicatorWrapper}>
            <div className={styles.splitIndicatorPt1}></div>
          </div>
        </div>
      )}
    </div>
  );
};

type BaseTimelineProps = {
  timelineTicks: number;
  splits: TimelineSplit[];
  backgroundColors?: TimelineColor[];
  bossAttackTimeline: NpcAttackEvent[];
  playerAttackTimelines: Map<string, Event[]>;
  updateTickOnPage: (tick: number) => void;
  npcs: RoomNpcMap;
  actorContext: RoomActorState;
};

function BaseTimeline(props: BaseTimelineProps) {
  const {
    timelineTicks,
    splits,
    backgroundColors,
    bossAttackTimeline,
    playerAttackTimelines,
    updateTickOnPage,
    npcs,
    actorContext,
  } = props;

  const memes = useContext(MemeContext);

  const attackTimelineColumnElements = [];
  for (let i = 0; i < timelineTicks; i++) {
    const tick = i + 1;

    let potentialSplit = undefined;

    for (const split of splits) {
      if (split.tick === tick) {
        potentialSplit = split;
      }
    }

    const color = backgroundColors?.find((c) => {
      const length = c.length ?? 1;
      return tick >= c.tick && tick < c.tick + length;
    })?.backgroundColor;

    attackTimelineColumnElements.push(
      buildTickColumn(
        bossAttackTimeline,
        playerAttackTimelines,
        tick,
        updateTickOnPage,
        npcs,
        actorContext,
        memes,
        potentialSplit,
        color,
      ),
    );
  }

  return <>{attackTimelineColumnElements}</>;
}

export type TimelineSplit = {
  tick: number;
  splitName: string;
  unimportant?: boolean;
  splitCustomContent?: JSX.Element;
};

export type TimelineColor = {
  tick: number;
  length?: number;
  backgroundColor: string;
};

interface AttackTimelineProps {
  currentTick: number;
  playing: boolean;
  playerAttackTimelines: Map<string, Event[]>;
  bossAttackTimeline: NpcAttackEvent[];
  timelineTicks: number;
  splits: TimelineSplit[];
  backgroundColors?: TimelineColor[];
  updateTickOnPage: (tick: number) => void;
  npcs: RoomNpcMap;
}

export function BossPageAttackTimeline(props: AttackTimelineProps) {
  const {
    currentTick,
    playerAttackTimelines,
    bossAttackTimeline,
    updateTickOnPage,
    timelineTicks,
    backgroundColors,
    splits,
    npcs,
  } = props;

  const actorContext = useContext(ActorContext);

  let nextBossAttackNpc = bossAttackTimeline.find(
    (evt) => evt.tick > currentTick,
  )?.npc;
  if (nextBossAttackNpc === undefined) {
    nextBossAttackNpc = bossAttackTimeline[bossAttackTimeline.length - 1]?.npc;
  }
  const npcName =
    getNpcDefinition(nextBossAttackNpc?.id ?? 0)?.shortName ?? 'Unknown';

  const attackTimelineRef = useRef<HTMLDivElement>(null);
  const currentTickColumnRef = useRef<HTMLDivElement>(null);

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
  }, []);

  useEffect(() => {
    if (
      attackTimelineRef.current !== null &&
      currentTickColumnRef.current !== null
    ) {
      if (currentTick * TOTAL_COLUMN_WIDTH < 525) {
        attackTimelineRef.current.scrollLeft = 0;
      } else {
        attackTimelineRef.current.scrollLeft =
          (currentTick - 1) * TOTAL_COLUMN_WIDTH - 380;
      }
    }
  }, [currentTick]);

  const attackTimelineParticipants = [
    npcName,
    ...Array.from(playerAttackTimelines.keys()),
  ];

  const attackTLLegendElements = [];

  for (let i = 0; i < attackTimelineParticipants.length; i++) {
    const name = attackTimelineParticipants[i];
    const isBoss = i === 0;

    let className = styles.attackTimeline__LegendParticipant;
    let onClick;

    if (isBoss) {
      onClick = () =>
        actorContext.setSelectedRoomNpc(nextBossAttackNpc?.roomId ?? null);
      className += ` ${styles.attackTimeline__LegendParticipant__Boss}`;
      if (nextBossAttackNpc?.roomId === actorContext.selectedRoomNpc) {
        // TODO(frolv): Support selected NPCs.
        // className += ` ${styles.selected}`;
      }
    } else {
      onClick = () =>
        actorContext.setSelectedPlayer((p) => (p === name ? null : name));
      if (name === actorContext.selectedPlayer) {
        className += ` ${styles.selected}`;
      }
    }
    attackTLLegendElements.push(
      <button
        className={className}
        key={`attack-tl-participant-${name}`}
        onClick={onClick}
      >
        {attackTimelineParticipants[i]}
      </button>,
    );
  }

  const memoizedBaseTimeline = useMemo(
    () => (
      <BaseTimeline
        timelineTicks={timelineTicks}
        splits={splits}
        backgroundColors={backgroundColors}
        bossAttackTimeline={bossAttackTimeline}
        playerAttackTimelines={playerAttackTimelines}
        updateTickOnPage={updateTickOnPage}
        npcs={npcs}
        actorContext={actorContext}
      />
    ),
    [
      timelineTicks,
      splits,
      backgroundColors,
      bossAttackTimeline,
      playerAttackTimelines,
      updateTickOnPage,
      npcs,
      actorContext,
    ],
  );

  return (
    <CollapsiblePanel
      panelTitle="Room Timeline"
      maxPanelHeight={500}
      defaultExpanded={true}
      className={styles.attackTimeline}
      panelWidth="100%"
    >
      <div className={styles.attackTimeline__Inner}>
        <div className={styles.attackTimeline__Legend}>
          {attackTLLegendElements}
        </div>
        <div
          className={styles.attackTimeline__Scrollable}
          ref={attackTimelineRef}
        >
          <div
            style={{
              left: TOTAL_COLUMN_WIDTH * (currentTick - 1) + 5,
              height: attackTLLegendElements.length * 55 + 40,
            }}
            className={styles.attackTimeline__ColumnActiveIndicator}
            ref={currentTickColumnRef}
          />
          {memoizedBaseTimeline}
        </div>
      </div>
    </CollapsiblePanel>
  );
}
