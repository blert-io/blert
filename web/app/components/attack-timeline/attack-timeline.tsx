'use client';

import {
  Npc,
  NpcAttack,
  PlayerAttack,
  PlayerSpell,
  Skill,
  SkillLevel,
  getNpcDefinition,
} from '@blert/common';
import Image from 'next/image';
import React, {
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import HorizontalScrollable from '@/components/horizontal-scrollable';
import Item from '@/components/item';
import { BlertMemes, MemeContext } from '@/(challenges)/raids/meme-context';
import {
  ActorContext,
  RoomActorState,
} from '@/(challenges)/challenge-context-provider';
import {
  PlayerState,
  PlayerStateMap,
  RoomNpcMap,
} from '@/utils/boss-room-state';
import { BoostType, maxBoostedLevel } from '@/utils/combat';
import { normalizeItemId } from '@/utils/item';

import {
  ATTACK_METADATA,
  CombatStyle,
  NPC_ATTACK_METADATA,
  SPELL_METADATA,
} from './attack-metadata';
import { TimelineTooltip } from './timeline-tooltip';

import styles from './style.module.scss';

const TIMELINE_TOOLTIP_ID = 'attack-timeline-tooltip';

const DEFAULT_CELL_SIZE = 30;
const COLUMN_MARGIN = 5;

// Legend dimensions. The "reserved" values include padding/margins for layout
// calculations, while the actual widths are the rendered element widths.
const LEGEND_WIDTH_SMALL = 50;
const LEGEND_WIDTH_SMALL_RESERVED = 75;
const LEGEND_WIDTH = 134;
const LEGEND_WIDTH_RESERVED = 140;

// Scrolling thresholds for auto-scroll behavior.
const SCROLL_THRESHOLD = 525;
const SCROLL_OFFSET = 380;

// Active column indicator positioning.
const INDICATOR_TOP_OFFSET = 67;
const INDICATOR_LEFT_PADDING = 9;
const INDICATOR_ROW_GAP = 23.5;
const INDICATOR_HEIGHT_PADDING = 32;

function npcAttackImage(attack: NpcAttack, size: number) {
  const meta =
    NPC_ATTACK_METADATA[attack] ?? NPC_ATTACK_METADATA[NpcAttack.UNKNOWN];

  return (
    <div className={styles.attackTimeline__CellImage}>
      <Image
        src={meta.imageUrl}
        alt={`NPC attack: ${attack}`}
        height={size}
        width={size}
        style={{ objectFit: 'contain' }}
      />
    </div>
  );
}

function makeCellImage(
  state: PlayerState,
  size: number,
  memes: BlertMemes,
  normalizeItems: boolean,
  showSpells: boolean,
) {
  let baseImage = undefined;
  let attackIcon = undefined;
  let spellIcon = undefined;

  const customStateEntries = [...state.customState];

  const playerAttack = state.attack ?? null;
  const playerSpell = showSpells ? (state.spell ?? null) : null;

  const hasBaseImage = playerAttack !== null || playerSpell !== null;

  if (playerAttack !== null) {
    // If a spell was cast alongside an attack, show it as an overlay icon.
    if (playerSpell !== null) {
      const spellMeta =
        SPELL_METADATA[playerSpell.type] ?? SPELL_METADATA[PlayerSpell.UNKNOWN];
      spellIcon = (
        <Image
          className={styles.spellIcon}
          src={spellMeta.imageUrl}
          alt={spellMeta.name}
          height={size / 2 + 2}
          width={size / 2 + 2}
          style={{ objectFit: 'contain' }}
        />
      );
    }

    const meta =
      ATTACK_METADATA[playerAttack.type] ??
      ATTACK_METADATA[PlayerAttack.UNKNOWN];

    if (memes.capsLock) {
      // In caps lock mode, only use letters.
      return (
        <div className={styles.attackTimeline__CellImage}>
          <div className={styles.letter}>{meta.letter}</div>
        </div>
      );
    }

    const trollStyles = {
      filter: 'drop-shadow(2px 4px 6px black)',
      transform: 'rotate(267deg) skewX(3.78rad)',
    };
    let troll = false;

    if (meta.special) {
      attackIcon = (
        <Image
          className={styles.infoIcon}
          src={'/spec.png'}
          alt="Special Attack"
          height={size / 2}
          width={size / 2}
        />
      );
    }

    switch (playerAttack.type) {
      case PlayerAttack.DARK_DEMONBANE:
        attackIcon = (
          <Image
            className={styles.infoIcon}
            src={'/images/combat/dark-demonbane.webp'}
            alt="Dark Demonbane"
            height={size / 2}
            width={size / 2}
            style={{ objectFit: 'contain' }}
          />
        );
        break;

      case PlayerAttack.KODAI_BARRAGE:
      case PlayerAttack.NM_STAFF_BARRAGE:
      case PlayerAttack.SANG_BARRAGE:
      case PlayerAttack.SCEPTRE_BARRAGE:
      case PlayerAttack.SHADOW_BARRAGE:
      case PlayerAttack.SOTD_BARRAGE:
      case PlayerAttack.STAFF_OF_LIGHT_BARRAGE:
      case PlayerAttack.TOXIC_TRIDENT_BARRAGE:
      case PlayerAttack.TOXIC_STAFF_BARRAGE:
      case PlayerAttack.TRIDENT_BARRAGE:
      case PlayerAttack.UNKNOWN_BARRAGE:
        attackIcon = (
          <Image
            className={styles.infoIcon}
            src={'/images/combat/barrage.png'}
            alt="Barrage"
            height={size / 2}
            width={size / 2}
          />
        );
        break;

      case PlayerAttack.ICE_RUSH:
        attackIcon = (
          <Image
            className={styles.infoIcon}
            src={'/images/combat/ice-rush.png'}
            alt="Ice Rush"
            height={size / 2 + 1}
            width={size / 2 + 1}
            style={{ objectFit: 'contain', bottom: -2 }}
          />
        );
        break;

      case PlayerAttack.GODSWORD_SMACK:
      case PlayerAttack.HAMMER_BOP:
      case PlayerAttack.ELDER_MAUL:
        if (playerAttack.target !== undefined) {
          const npcId = playerAttack.target.id;
          if (
            !Npc.isNylocas(npcId) &&
            !Npc.isVerzikMatomenos(npcId) &&
            !Npc.isFremennikArcher(npcId)
          ) {
            troll = true;
          }
        }
        break;

      case PlayerAttack.CHALLY_SWIPE:
      case PlayerAttack.TONALZTICS_AUTO:
        if (playerAttack.target !== undefined) {
          if (!Npc.isVerzikMatomenos(playerAttack.target.id)) {
            troll = true;
          }
        }
        break;

      case PlayerAttack.KODAI_BASH:
      case PlayerAttack.NM_STAFF_BASH:
      case PlayerAttack.SCYTHE_UNCHARGED:
      case PlayerAttack.TONALZTICS_UNCHARGED:
        troll = true;
        break;
    }

    const outline = memes.inventoryTags ? meta.tagColor : undefined;

    if (playerAttack.weapon) {
      baseImage = (
        <Item
          id={
            normalizeItems
              ? normalizeItemId(playerAttack.weapon.id)
              : playerAttack.weapon.id
          }
          name={playerAttack.weapon.name}
          quantity={1}
          outlineColor={outline}
          size={size}
          style={troll ? trollStyles : undefined}
        />
      );
    } else {
      let customImageUrl: string;
      switch (playerAttack.type) {
        case PlayerAttack.PUNCH:
          customImageUrl = '/images/combat/punch.webp';
          break;
        case PlayerAttack.KICK:
          customImageUrl = '/images/combat/kick.webp';
          break;
        default:
          customImageUrl = '/images/huh.png';
          break;
      }

      baseImage = (
        <Image
          src={customImageUrl}
          alt="Unknown attack"
          height={size}
          width={size}
          style={{ objectFit: 'contain' }}
        />
      );
    }
  } else if (playerSpell !== null) {
    const meta =
      SPELL_METADATA[playerSpell.type] ?? SPELL_METADATA[PlayerSpell.UNKNOWN];
    baseImage = (
      <Image
        src={meta.imageUrl}
        alt={meta.name}
        height={size}
        width={size}
        style={{ objectFit: 'contain', opacity: meta.opacity }}
      />
    );
  }

  if (hasBaseImage) {
    if (state.diedThisTick) {
      customStateEntries.push({
        icon: '/skull.webp',
        label: `${state.player.name} died this tick`,
      });
    }
  } else if (state.diedThisTick) {
    baseImage = (
      <Image
        src="/skull.webp"
        alt="Player died"
        height={size}
        width={size}
        style={{ objectFit: 'contain' }}
      />
    );
  } else {
    baseImage = <span className={styles.attackTimeline__Nothing}></span>;
  }

  let customState;
  if (customStateEntries.length > 0) {
    customState = customStateEntries.map((cs, i) => (
      <div className={styles.customState} key={i}>
        {cs.icon ? (
          <Image
            src={cs.icon}
            alt={cs.fullText ?? cs.label ?? ''}
            height={size / 2}
            width={size / 2}
            style={{ objectFit: 'contain' }}
          />
        ) : (
          <span>{cs.label}</span>
        )}
      </div>
    ));
  }

  return (
    <div className={styles.attackTimeline__CellImage}>
      {baseImage}
      {customState}
      {spellIcon}
      {attackIcon}
    </div>
  );
}

type CellNpcState = {
  npcId: number;
  roomId: number;
  tick: number;
  attack: NpcAttack | null;
  target: string | null;
  label?: string;
};

type CellInfo = {
  playerState: PlayerState | null;
  npcState: CellNpcState | null;
  customRenderer: ((tick: number, size: number) => React.ReactNode) | null;
  highlighted: boolean;
  backgroundColor?: string;
};

const buildTickCell = (
  context: TimelineContext,
  actorIndex: number,
  cellInfo: CellInfo,
  tick: number,
) => {
  const { playerState, npcState, backgroundColor } = cellInfo;

  const imageSize = context.cellSize - 2;

  const style: React.CSSProperties = {
    backgroundColor,
    width: context.cellSize,
    height: context.cellSize,
  };

  if (
    playerState === null &&
    npcState === null &&
    cellInfo.customRenderer === null
  ) {
    return (
      <div
        className={styles.cell}
        key={`empty-cell-${tick}-${actorIndex}`}
        style={style}
      >
        <span className={styles.attackTimeline__Nothing}></span>
      </div>
    );
  }

  if (cellInfo.customRenderer !== null) {
    const content = cellInfo.customRenderer(tick, imageSize);
    let className = styles.cell;
    if (content !== null) {
      className += ` ${styles.attackTimeline__CellOffCooldown}`;
    }

    return (
      <div
        className={className}
        key={`custom-cell-${tick}-${actorIndex}`}
        style={style}
      >
        {content}
      </div>
    );
  }

  if (npcState !== null) {
    let cellImage;
    let className = styles.cell;

    if (npcState.attack !== null) {
      cellImage = npcAttackImage(npcState.attack, imageSize);
      className += ` ${styles.npcCooldown}`;
    }

    return (
      <div
        className={className}
        key={`npc-${npcState.roomId}-${npcState.tick}`}
        style={style}
        data-tooltip-id={TIMELINE_TOOLTIP_ID}
        data-tooltip-type="npc"
        data-tooltip-room-id={npcState.roomId}
        data-tooltip-tick={npcState.tick}
      >
        {cellImage}
        <span
          className={styles.label}
          style={{ fontSize: Math.min(context.cellSize / 2 - 2, 10) }}
        >
          {npcState.label}
        </span>
      </div>
    );
  }

  if (playerState !== null) {
    const username = playerState.player.name;
    const playerIsOffCooldown =
      playerState.player.offCooldownTick <= playerState.tick;

    const diedThisTick = playerState.diedThisTick;
    const playerIsDead = playerState.isDead;

    const cellImage = makeCellImage(
      playerState,
      imageSize,
      context.memes,
      context.normalizeItems,
      context.showSpells,
    );

    if (playerState.attack !== undefined) {
      const attack = playerState.attack;

      const meta =
        ATTACK_METADATA[attack.type] ?? ATTACK_METADATA[PlayerAttack.UNKNOWN];

      let combatSkill: SkillLevel | undefined = undefined;
      let boostType: BoostType;

      switch (meta.style) {
        case CombatStyle.MELEE:
          combatSkill = playerState.skills[Skill.STRENGTH];
          boostType = BoostType.SUPER_COMBAT;
          break;
        case CombatStyle.RANGED:
          combatSkill = playerState.skills[Skill.RANGED];
          boostType = BoostType.RANGING_POTION;
          break;
        case CombatStyle.MAGIC:
          combatSkill = playerState.skills[Skill.MAGIC];
          boostType = BoostType.SATURATED_HEART;
          break;
        default:
          break;
      }

      if (combatSkill !== undefined) {
        if (
          combatSkill.getCurrent() ===
          maxBoostedLevel(boostType!, combatSkill.getBase())
        ) {
          style.outline = '1px solid rgba(var(--blert-green-base), 0.25)';
        } else if (combatSkill.getCurrent() > combatSkill.getBase()) {
          style.outline = '1px solid rgba(var(--blert-yellow-base), 0.5)';
        } else {
          style.outline = '1px solid rgba(var(--blert-red-base), 0.5)';
        }
      } else {
        style.outline =
          '1px solid rgba(var(--blert-font-color-primary-base), 0.2)';
      }
    }

    let className = styles.cell;
    if (
      playerIsOffCooldown ||
      diedThisTick ||
      playerState.attack !== undefined ||
      (context.showSpells && playerState.spell !== undefined)
    ) {
      className += ` ${styles.attackTimeline__CellOffCooldown}`;
    }
    if (playerIsDead && !diedThisTick) {
      className += ` ${styles.cellDead}`;
      style.backgroundColor = undefined;
    }

    return (
      <div
        className={className}
        style={style}
        key={`player-cell-${username}-${playerState.tick}`}
        data-tooltip-id={TIMELINE_TOOLTIP_ID}
        data-tooltip-type="player"
        data-tooltip-username={username}
        data-tooltip-tick={playerState.tick}
      >
        {cellImage}
      </div>
    );
  }
};

const buildTickColumn = (
  context: TimelineContext,
  columnTick: number,
  split?: TimelineSplit,
  backgroundColor?: string,
) => {
  const tickCells = [];
  const cellInfo: CellInfo[] = [];

  const { selectedPlayer } = context.actorContext;

  context.npcs.forEach((npc, _) => {
    if (!npc.hasAttacks) {
      return;
    }

    let npcState: CellNpcState | null = null;

    const attack = npc.stateByTick[columnTick]?.attack ?? null;
    const label = npc.stateByTick[columnTick]?.label;

    const partialNpcState = {
      npcId: npc.spawnNpcId,
      roomId: npc.roomId,
      tick: columnTick,
      label,
    };

    if (attack !== null) {
      npcState = {
        ...partialNpcState,
        attack: attack.type,
        target: attack.target,
      };
    } else if (label !== undefined) {
      npcState = {
        ...partialNpcState,
        attack: null,
        target: null,
      };
    }

    cellInfo.push({
      npcState,
      playerState: null,
      customRenderer: null,
      highlighted: false,
      backgroundColor,
    });
  });

  context.customRows.forEach((row) => {
    cellInfo.push({
      npcState: null,
      playerState: null,
      customRenderer: row.cellRenderer,
      highlighted: false,
      backgroundColor,
    });
  });

  context.playerState.forEach((playerTimeline, playerName) => {
    const state = playerTimeline.find((event) => event?.tick === columnTick);
    cellInfo.push({
      npcState: null,
      playerState: state ?? null,
      customRenderer: null,
      highlighted: selectedPlayer === playerName,
      backgroundColor,
    });
  });

  for (let i = 0; i < cellInfo.length; i++) {
    tickCells.push(buildTickCell(context, i, cellInfo[i], columnTick));
  }

  const splitWidth = context.cellSize + 21;
  const splitTailOffset = (splitWidth - 4) / 2;

  return (
    <div
      key={`attackTimeline__${columnTick}`}
      className={styles.attackTimeline__Column}
      style={{ width: context.cellSize }}
    >
      {split !== undefined && (
        <div
          className={styles.attackTimeline__RoomSplit}
          style={{ width: splitWidth - 1 }}
        >
          <span>{split.splitName}</span>
          <div className={styles.splitIndicatorWrapper}>
            <div className={styles.splitIndicatorPt1}></div>
            <div
              className={styles.splitIndicatorPt2}
              style={{ left: splitTailOffset + 1 }}
            ></div>
          </div>
        </div>
      )}
      <button
        className={styles.attackTimeline__TickHeader}
        onClick={() => context.updateTickOnPage(columnTick)}
        style={{ fontSize: context.cellSize / 2 - 1 }}
      >
        {columnTick}
      </button>
      {tickCells}
      {split !== undefined && (
        <div
          className={`${styles.attackTimeline__RoomSplit} ${styles.splitIndicatorBottom}`}
          style={{ width: splitWidth - 1 }}
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
  splits?: TimelineSplit[];
  customRows?: CustomRow[];
  backgroundColors?: TimelineColor[];
  playerState: PlayerStateMap;
  updateTickOnPage: (tick: number) => void;
  npcs: RoomNpcMap;
  actorContext: RoomActorState;
  memes: BlertMemes;
  cellSize: number;
  wrapWidth?: number;
  numRows: number;
  ticksPerRow: number;
  timelineTicks: number;
  normalizeItems: boolean;
  showSpells: boolean;
};

type TimelineContext = Required<
  Pick<
    BaseTimelineProps,
    | 'actorContext'
    | 'cellSize'
    | 'customRows'
    | 'memes'
    | 'normalizeItems'
    | 'npcs'
    | 'playerState'
    | 'showSpells'
    | 'updateTickOnPage'
  >
>;

function BaseTimeline(props: BaseTimelineProps) {
  const {
    splits = [],
    customRows = [],
    backgroundColors,
    playerState,
    updateTickOnPage,
    npcs,
    actorContext,
    memes,
    cellSize,
    numRows,
    ticksPerRow,
    timelineTicks,
    normalizeItems,
    showSpells,
  } = props;

  const attackTimelineColumnElements = [];

  const context: TimelineContext = {
    actorContext,
    cellSize,
    customRows,
    memes,
    normalizeItems,
    npcs,
    playerState,
    showSpells,
    updateTickOnPage,
  };

  for (let row = 0; row < numRows; row++) {
    const rowColumns = [];

    for (let i = 0; i < ticksPerRow; i++) {
      const tick = row * ticksPerRow + i + 1;
      if (tick > timelineTicks) {
        break;
      }

      const potentialSplit = splits.find((split) => split.tick === tick);

      const color = backgroundColors?.find((c) => {
        const length = c.length ?? 1;
        return tick >= c.tick && tick < c.tick + length;
      })?.backgroundColor;

      rowColumns.push(buildTickColumn(context, tick, potentialSplit, color));
    }

    attackTimelineColumnElements.push(
      <div key={`row-${row}`} className={styles.row}>
        {rowColumns}
      </div>,
    );
  }

  return <>{attackTimelineColumnElements}</>;
}

export type TimelineSplit = {
  tick: number;
  splitName: string;
  unimportant?: boolean;
  splitCustomContent?: React.ReactNode;
};

export type TimelineColor = {
  tick: number;
  length?: number;
  backgroundColor: string;
};

export type CustomRow = {
  name: string;
  cellRenderer: (tick: number, size: number) => React.ReactNode;
};

export type AttackTimelineProps = {
  currentTick: number;
  playing: boolean;
  playerState: PlayerStateMap;
  timelineTicks: number;
  splits?: TimelineSplit[];
  backgroundColors?: TimelineColor[];
  customRows?: CustomRow[];
  updateTickOnPage: (tick: number) => void;
  npcs: RoomNpcMap;
  cellSize?: number;
  smallLegend?: boolean;
  wrapWidth?: number;
  normalizeItems?: boolean;
  showSpells?: boolean;
};

type RowType = 'npc' | 'player' | 'custom';

export function AttackTimeline(props: AttackTimelineProps) {
  const {
    currentTick,
    playerState,
    updateTickOnPage,
    timelineTicks,
    backgroundColors,
    npcs,
    cellSize = DEFAULT_CELL_SIZE,
    splits,
    customRows,
    wrapWidth,
    normalizeItems = false,
    showSpells = true,
  } = props;

  const totalColumnWidth = cellSize + COLUMN_MARGIN;

  const actorContext = useContext(ActorContext);
  const memes = useContext(MemeContext);

  const attackTimelineRef = useRef<HTMLDivElement>(null);
  const currentTickColumnRef = useRef<HTMLDivElement>(null);

  const shouldScroll = wrapWidth === undefined;

  useEffect(() => {
    if (!shouldScroll) {
      return;
    }

    if (
      attackTimelineRef.current !== null &&
      currentTickColumnRef.current !== null
    ) {
      if (currentTick * totalColumnWidth < SCROLL_THRESHOLD) {
        attackTimelineRef.current.scrollLeft = 0;
      } else {
        attackTimelineRef.current.scrollLeft =
          (currentTick - 1) * totalColumnWidth - SCROLL_OFFSET;
      }
    }
  }, [shouldScroll, currentTick, totalColumnWidth]);

  const attackTimelineParticipants: [RowType, string, number][] = [];
  npcs.forEach((npc, roomId) => {
    if (npc.hasAttacks) {
      attackTimelineParticipants.push([
        'npc',
        getNpcDefinition(npc.spawnNpcId)?.shortName ?? 'Unknown',
        roomId,
      ]);
    }
  });

  customRows?.forEach((row) => {
    attackTimelineParticipants.push(['custom', row.name, 0]);
  });

  playerState.forEach((_, playerName) => {
    attackTimelineParticipants.push(['player', playerName, 0]);
  });

  let ticksPerRow = timelineTicks;
  let numRows = 1;

  if (wrapWidth !== undefined) {
    const legendReserved = props.smallLegend
      ? LEGEND_WIDTH_SMALL_RESERVED
      : LEGEND_WIDTH_RESERVED;
    const timelineWidth = wrapWidth - legendReserved;
    ticksPerRow = Math.floor(timelineWidth / (cellSize + COLUMN_MARGIN));
    numRows = Math.ceil(timelineTicks / ticksPerRow);
  }

  const legendElements: React.ReactNode[] = [];

  for (let i = 0; i < attackTimelineParticipants.length; i++) {
    const [type, name, id] = attackTimelineParticipants[i];

    let className = styles.legendParticipant;
    let onClick;

    if (type === 'npc') {
      onClick = () => actorContext.setSelectedRoomNpc(id);
      className += ` ${styles.npc}`;
      if (id === actorContext.selectedRoomNpc) {
        // TODO(frolv): Support selected NPCs.
        // className += ` ${styles.selected}`;
      }
    } else if (type === 'custom') {
      className += ` ${styles.custom}`;
    } else {
      onClick = () =>
        actorContext.setSelectedPlayer((p) => (p === name ? null : name));
      if (name === actorContext.selectedPlayer) {
        className += ` ${styles.selected}`;
      }
    }
    legendElements.push(
      <button
        className={className}
        key={i}
        onClick={onClick}
        style={{ height: cellSize }}
      >
        {props.smallLegend ? name[0] : name}
      </button>,
    );
  }

  const memoizedBaseTimeline = useMemo(
    () => (
      <BaseTimeline
        splits={splits}
        customRows={customRows}
        backgroundColors={backgroundColors}
        playerState={playerState}
        updateTickOnPage={updateTickOnPage}
        npcs={npcs}
        actorContext={actorContext}
        memes={memes}
        cellSize={cellSize}
        numRows={numRows}
        ticksPerRow={ticksPerRow}
        timelineTicks={timelineTicks}
        normalizeItems={normalizeItems}
        showSpells={showSpells}
      />
    ),
    [
      splits,
      backgroundColors,
      playerState,
      updateTickOnPage,
      npcs,
      actorContext,
      memes,
      cellSize,
      numRows,
      ticksPerRow,
      timelineTicks,
      normalizeItems,
      customRows,
      showSpells,
    ],
  );

  const row = Math.floor((currentTick - 1) / ticksPerRow);
  const tickOnRow = (currentTick - 1) % ticksPerRow;
  const rowHeight = legendElements.length * totalColumnWidth;

  const activeColumnIndicator = (
    <div
      style={{
        left: totalColumnWidth * tickOnRow + INDICATOR_LEFT_PADDING,
        top:
          INDICATOR_TOP_OFFSET +
          row * (rowHeight + INDICATOR_TOP_OFFSET + INDICATOR_ROW_GAP),
        height: rowHeight + INDICATOR_HEIGHT_PADDING,
        width: totalColumnWidth + 1,
      }}
      className={styles.attackTimeline__ColumnActiveIndicator}
      ref={currentTickColumnRef}
    />
  );
  const deferredColumnIndicator = useDeferredValue(activeColumnIndicator);

  return (
    <div className={styles.attackTimeline__Inner}>
      <div
        className={styles.attackTimeline__Legend}
        style={{ width: props.smallLegend ? LEGEND_WIDTH_SMALL : LEGEND_WIDTH }}
      >
        {Array.from({ length: numRows }).map((_, i) => (
          <div className={styles.legendRow} key={i}>
            {legendElements}
          </div>
        ))}
      </div>
      <HorizontalScrollable
        className={styles.attackTimeline__Scrollable}
        customRef={attackTimelineRef}
        disable={!shouldScroll}
      >
        {deferredColumnIndicator}
        {memoizedBaseTimeline}
      </HorizontalScrollable>
      <TimelineTooltip
        id={TIMELINE_TOOLTIP_ID}
        playerState={playerState}
        npcs={npcs}
      />
    </div>
  );
}
