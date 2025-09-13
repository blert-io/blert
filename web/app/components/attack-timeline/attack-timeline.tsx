'use client';

import {
  DataSource,
  Npc,
  NpcAttack,
  PlayerAttack,
  Skill,
  SkillLevel,
  getNpcDefinition,
  npcFriendlyName,
} from '@blert/common';
import Image from 'next/image';
import React, {
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import Tooltip from '@/components/tooltip';
import HorizontalScrollable from '@/components/horizontal-scrollable';
import Item from '@/components/item';
import { BlertMemes, MemeContext } from '@/(challenges)/raids/meme-context';
import { ActorContext, RoomActorState } from '@/(challenges)/raids/tob/context';
import {
  CustomPlayerState,
  PlayerState,
  PlayerStateMap,
  RoomNpcMap,
} from '@/utils/boss-room-state';
import { BoostType, maxBoostedLevel } from '@/utils/combat';
import { normalizeItemId } from '@/utils/item';
import { ticksToFormattedSeconds } from '@/utils/tick';

import {
  ATTACK_METADATA,
  CombatStyle,
  NPC_ATTACK_METADATA,
} from './attack-metadata';
import PlayerSkill from '../player-skill';
import KeyPrayers from '../key-prayers';

import styles from './style.module.scss';

const DEFAULT_CELL_SIZE = 30;
const COLUMN_MARGIN = 5;

const TIMELINE_TOOLTIP_ID = 'attack-timeline-tooltip';

function TimelineTooltipRenderer({
  activeAnchor,
}: {
  activeAnchor: HTMLElement | null;
}) {
  const { setSelectedPlayer } = useContext(ActorContext);

  if (!activeAnchor) {
    return null;
  }
  if (activeAnchor.dataset.tooltipType === 'npc') {
    const npcName = activeAnchor.dataset.tooltipNpcName;
    const npcAttack = parseInt(activeAnchor.dataset.tooltipNpcAttack ?? '0');
    const npcTarget = activeAnchor.dataset.tooltipNpcTarget;

    const meta =
      NPC_ATTACK_METADATA[npcAttack] ?? NPC_ATTACK_METADATA[NpcAttack.UNKNOWN];

    const npcButton = <button className={styles.npc}>{npcName}</button>;
    const target = npcTarget ? (
      <button onClick={() => setSelectedPlayer(npcTarget)}>{npcTarget}</button>
    ) : null;

    return (
      <div className={styles.tooltip}>
        <div className={styles.npcTooltip}>
          {meta.description(npcButton, target)}
        </div>
      </div>
    );
  }

  const username = activeAnchor.dataset.tooltipUsername;
  const tick = activeAnchor.dataset.tooltipTick;
  const customState = JSON.parse(
    activeAnchor.dataset.tooltipCustomState ?? '[]',
  );

  if (!username || !tick) {
    return null;
  }

  const sections: React.ReactNode[] = [];

  const headerSection = (
    <div className={styles.tooltipHeader} key="header">
      <button
        className={styles.playerName}
        onClick={() => setSelectedPlayer(username)}
      >
        {username}
      </button>
      <span className={styles.tickInfo}>Tick {tick}</span>
      <span className={styles.timeInfo}>
        {ticksToFormattedSeconds(parseInt(tick))}
      </span>
    </div>
  );
  sections.push(headerSection);

  const attackType = activeAnchor.dataset.tooltipAttack;
  if (attackType) {
    const attack = parseInt(attackType) as PlayerAttack;
    const hitpoints = activeAnchor.dataset.tooltipTargetHp;
    const distance = activeAnchor.dataset.tooltipDistance;
    const targetName = activeAnchor.dataset.tooltipTargetName;

    const meta =
      ATTACK_METADATA[attack] ?? ATTACK_METADATA[PlayerAttack.UNKNOWN];

    const attackSection = (
      <div className={styles.tooltipSection} key="attack">
        <div className={styles.sectionHeader}>
          <i className="fas fa-bolt" />
          <span>Attack</span>
        </div>
        <div className={styles.attackInfo}>
          <span className={styles.attackVerb}>{meta.verb}</span>
          <button className={styles.npc}>
            {targetName}
            {hitpoints && (
              <span className={styles.hitpoints}>
                <i className="far fa-heart" />
                {hitpoints}%
              </span>
            )}
          </button>
          {meta.ranged && (
            <span className={styles.distanceInfo}>
              from {distance} tile{distance === '1' ? '' : 's'} away
            </span>
          )}
        </div>
      </div>
    );
    sections.push(attackSection);
  }

  const rawStats = activeAnchor.dataset.tooltipStats;
  const prayerSet = activeAnchor.dataset.tooltipPrayerSet;
  if (rawStats) {
    const [attack, strength, ranged, magic] = JSON.parse(rawStats).map(
      (s: number) => (s !== undefined ? SkillLevel.fromRaw(s) : undefined),
    );

    const combatThresholds = (boost: BoostType, level: number) => ({
      high: maxBoostedLevel(boost, level),
      low: level,
    });

    const stats = [];

    const attackTypeParsed = activeAnchor.dataset.tooltipAttack
      ? (parseInt(activeAnchor.dataset.tooltipAttack) as PlayerAttack)
      : null;
    const meta = attackTypeParsed
      ? (ATTACK_METADATA[attackTypeParsed] ??
        ATTACK_METADATA[PlayerAttack.UNKNOWN])
      : null;
    const emphasizedClass = (style: CombatStyle) =>
      meta?.style === style
        ? `${styles.combatStat} ${styles.emphasized}`
        : styles.combatStat;

    if (attack !== undefined) {
      stats.push(
        <PlayerSkill
          className={emphasizedClass(CombatStyle.MELEE)}
          key="attack"
          skill={Skill.ATTACK}
          level={attack}
          thresholds={combatThresholds(
            BoostType.SUPER_COMBAT,
            attack.getBase(),
          )}
        />,
      );
    }
    if (strength !== undefined) {
      stats.push(
        <PlayerSkill
          className={emphasizedClass(CombatStyle.MELEE)}
          key="strength"
          skill={Skill.STRENGTH}
          level={strength}
          thresholds={combatThresholds(
            BoostType.SUPER_COMBAT,
            strength.getBase(),
          )}
        />,
      );
    }

    if (ranged !== undefined) {
      stats.push(
        <PlayerSkill
          className={emphasizedClass(CombatStyle.RANGED)}
          key="ranged"
          skill={Skill.RANGED}
          level={ranged}
          thresholds={combatThresholds(
            BoostType.RANGING_POTION,
            ranged.getBase(),
          )}
        />,
      );
    }

    if (magic !== undefined) {
      stats.push(
        <PlayerSkill
          className={emphasizedClass(CombatStyle.MAGIC)}
          key="magic"
          skill={Skill.MAGIC}
          level={magic}
          thresholds={combatThresholds(
            BoostType.SATURATED_HEART,
            magic.getBase(),
          )}
        />,
      );
    }

    if (stats.length > 0) {
      const statsSection = (
        <div className={styles.tooltipSection} key="stats">
          <div className={styles.sectionHeader}>
            <i className="fas fa-chart-bar" />
            <span>Combat Stats</span>
          </div>
          <div className={styles.statsGrid}>{stats}</div>
          <KeyPrayers
            combatOnly
            prayerSet={parseInt(prayerSet ?? '0')}
            source={DataSource.PRIMARY}
          />
        </div>
      );
      sections.push(statsSection);
    }
  }

  if (activeAnchor.dataset.tooltipDeathState) {
    const deathSection = (
      <div className={styles.tooltipSection} key="death">
        <div className={styles.sectionHeader}>
          <i className="fas fa-skull" />
          <span>Death</span>
        </div>
        <div className={styles.deathInfo}>
          {activeAnchor.dataset.tooltipDeathState === 'tick'
            ? 'Player died this tick'
            : 'Player is dead'}
        </div>
      </div>
    );
    sections.push(deathSection);
  }

  if (customState.length > 0) {
    const customStateSection = (
      <div className={styles.tooltipSection} key="custom-state">
        <div className={styles.sectionHeader}>
          <i className="fas fa-info-circle" />
          <span>Other</span>
        </div>
        <div className={styles.customStateList}>
          {customState.map((cs: CustomPlayerState, i: number) => (
            <div key={i} className={styles.customStateItem}>
              <div className={styles.customStateIcon}>
                {cs.icon ? (
                  <Image
                    src={cs.icon}
                    alt={cs.label}
                    height={16}
                    width={16}
                    style={{ objectFit: 'contain' }}
                  />
                ) : (
                  <i className="fas fa-star" />
                )}
              </div>
              <span className={styles.customStateLabel}>
                {cs.fullText ?? cs.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
    sections.push(customStateSection);
  }

  if (sections.length === 1) {
    // Only the header exists.
    sections.push(
      <div
        className={`${styles.tooltipSection} ${styles.noContent}`}
        key="no-content"
      >
        Nothing interesting happened.
      </div>,
    );
  }

  return (
    <div className={styles.tooltip}>
      {sections.map((section, index) => (
        <React.Fragment key={index}>
          {section}
          {index < sections.length - 1 && (
            <div className={styles.sectionDivider} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

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
) {
  let baseImage = undefined;
  let attackIcon = undefined;

  const customStateEntries = [...state.customState];

  const playerAttack = state.attack;
  if (playerAttack === undefined) {
    if (state.diedThisTick) {
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
  } else {
    if (state.diedThisTick) {
      customStateEntries.push({
        icon: '/skull.webp',
        label: `${state.player.name} died this tick`,
      });
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
          className={styles.attackTimeline__CellImage__InfoIcon}
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
            className={styles.attackTimeline__CellImage__InfoIcon}
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
            className={styles.attackTimeline__CellImage__InfoIcon}
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
            className={styles.attackTimeline__CellImage__InfoIcon}
            src={'/images/combat/ice-rush.png'}
            alt="Barrage"
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

    let outline = memes.inventoryTags ? meta.tagColor : undefined;

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

function buildPlayerTooltip(
  context: TimelineContext,
  state: PlayerState,
  imageSize: number,
): {
  playerTooltip: Record<string, string>;
  cellImage: React.ReactNode;
} {
  const cellImage = makeCellImage(
    state,
    imageSize,
    context.memes,
    context.normalizeItems,
  );

  const playerTooltip: Record<string, string> = {
    'data-tooltip-username': state.player.name,
    'data-tooltip-tick': state.tick.toString(),
    'data-tooltip-custom-state': JSON.stringify(state.customState),
  };

  if (state.diedThisTick) {
    playerTooltip['data-tooltip-death-state'] = 'tick';
  } else if (state.isDead) {
    playerTooltip['data-tooltip-death-state'] = 'dead';
  }

  const attack = state.attack;
  if (attack !== undefined) {
    playerTooltip['data-tooltip-attack'] = attack.type.toString();
    playerTooltip['data-tooltip-distance'] = attack.distanceToTarget.toString();

    const maybeTarget = attack.target;
    if (maybeTarget !== undefined) {
      const roomNpc = context.npcs.get(maybeTarget.roomId);
      if (roomNpc !== undefined) {
        playerTooltip['data-tooltip-target-name'] = npcFriendlyName(
          roomNpc,
          context.npcs,
        );
        const hitpoints = roomNpc.stateByTick[state.tick]?.hitpoints;
        if (hitpoints !== undefined) {
          playerTooltip['data-tooltip-target-hp'] = hitpoints
            .percentage()
            .toFixed(2);
        }
      }
    }
  }

  if (state.player.source === DataSource.PRIMARY) {
    playerTooltip['data-tooltip-stats'] = JSON.stringify([
      state.skills[Skill.ATTACK]?.toRaw(),
      state.skills[Skill.STRENGTH]?.toRaw(),
      state.skills[Skill.RANGED]?.toRaw(),
      state.skills[Skill.MAGIC]?.toRaw(),
    ]);
    playerTooltip['data-tooltip-prayer-set'] =
      state.player.prayerSet.toString();
  }

  return { playerTooltip, cellImage };
}

const buildTickCell = (
  context: TimelineContext,
  actorIndex: number,
  cellInfo: CellInfo,
  tick: number,
) => {
  let { playerState, npcState, backgroundColor } = cellInfo;

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

  let tooltip: Record<string, string> | undefined = undefined;

  if (npcState !== null) {
    let cellImage;
    let className = styles.cell;

    if (npcState.attack !== null) {
      cellImage = npcAttackImage(npcState.attack, imageSize);
      const npcName = getNpcDefinition(npcState.npcId)?.fullName ?? 'Unknown';

      tooltip = {
        'data-tooltip-type': 'npc',
        'data-tooltip-npc-name': npcName,
        'data-tooltip-npc-attack': npcState.attack.toString(),
      };

      if (npcState.target !== null) {
        tooltip['data-tooltip-npc-target'] = npcState.target;
      }

      className += ` ${styles.npcCooldown} ${styles.cellInteractable}`;
    }

    return (
      <div
        className={className}
        key={`npc-${npcState.roomId}-${npcState.tick}`}
        data-tooltip-id={TIMELINE_TOOLTIP_ID}
        style={style}
        {...tooltip}
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

    const { playerTooltip, cellImage } = buildPlayerTooltip(
      context,
      playerState,
      imageSize,
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
        style.outline = '1px solid rgba(var(--blert-text-color-base), 0.2)';
      }
    }

    let className = styles.cell;
    if (tooltip !== undefined) {
      className += ` ${styles.cellInteractable}`;
    }
    if (
      playerIsOffCooldown ||
      diedThisTick ||
      playerState.attack !== undefined
    ) {
      className += ` ${styles.attackTimeline__CellOffCooldown}`;
    }
    if (playerIsDead && !diedThisTick) {
      className += ` ${styles.cellDead}`;
      style.backgroundColor = undefined;
    }

    if (playerTooltip !== undefined) {
      playerTooltip['data-tooltip-id'] = TIMELINE_TOOLTIP_ID;
    }

    return (
      <div
        className={className}
        style={style}
        key={`player-cell-${username}-${playerState.tick}`}
        {...playerTooltip}
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

    let partialNpcState = {
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
      style={{ width: context.cellSize, marginRight: COLUMN_MARGIN }}
    >
      {split !== undefined && (
        <div
          className={styles.attackTimeline__RoomSplit}
          style={{ width: splitWidth }}
        >
          <span>{split.splitName}</span>
          <div className={styles.splitIndicatorWrapper}>
            <div className={styles.splitIndicatorPt1}></div>
            <div
              className={styles.splitIndicatorPt2}
              style={{ left: splitTailOffset }}
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
          style={{ width: splitWidth }}
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
  } = props;

  const attackTimelineColumnElements = [];

  const context: TimelineContext = {
    actorContext,
    cellSize,
    customRows,
    memes,
    normalizeItems,
    npcs,
    updateTickOnPage,
    playerState,
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
      if (currentTick * totalColumnWidth < 525) {
        attackTimelineRef.current.scrollLeft = 0;
      } else {
        attackTimelineRef.current.scrollLeft =
          (currentTick - 1) * totalColumnWidth - 380;
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
    const timelineWidth = wrapWidth - (props.smallLegend ? 75 : 140);
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
    ],
  );

  const row = Math.floor((currentTick - 1) / ticksPerRow);
  const tickOnRow = (currentTick - 1) % ticksPerRow;
  const rowHeight = legendElements.length * totalColumnWidth;
  const ACTIVE_INDICATOR_OFFSET = 67;

  const activeColumnIndicator = (
    <div
      style={{
        left: totalColumnWidth * tickOnRow + 5,
        top:
          ACTIVE_INDICATOR_OFFSET +
          row * (rowHeight + ACTIVE_INDICATOR_OFFSET + 23.5),
        height: rowHeight + 40,
        width: totalColumnWidth + 3,
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
        style={{ width: props.smallLegend ? 50 : 134 }}
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
      <Tooltip
        clickable
        tooltipId={TIMELINE_TOOLTIP_ID}
        render={TimelineTooltipRenderer}
      />
    </div>
  );
}
