'use client';

import { BCFAction, BCFPlayerAction, BCFResolver } from '@blert/bcf';
import { PlayerAttack } from '@blert/common';
import Image from 'next/image';
import { useContext } from 'react';

import { simpleItemCache } from '@/utils/item-cache/simple';

import {
  getAttackIcon,
  getNpcAttackImage,
  getSpellImage,
  getWeaponImage,
} from './attack-icons';
import { ATTACK_METADATA, bcfToPlayerAttack } from './attack-metadata';
import { HintImage } from './hint-image';
import {
  ActionEvaluation,
  ActionEvaluator,
  CustomState,
  getBackgroundColorVariable,
  mergeEvaluations,
  RenderContext,
} from './types';

import styles from './bcf-renderer.module.scss';

type CustomStatesProps = {
  states: CustomState[];
};

function CustomStates({ states }: CustomStatesProps) {
  const { cellSize } = useContext(RenderContext);
  const iconSize = Math.floor(cellSize / 2);

  if (states.length === 0) {
    return null;
  }

  // Only show the first state on the cell; others are visible in the tooltip.
  const first = states[0];
  const hasMore = states.length > 1;
  const iconAlt = first.fullText ?? first.label ?? '';

  return (
    <div className={styles.customStates}>
      <div>
        {first.iconUrl ? (
          <HintImage src={first.iconUrl} alt={iconAlt} size={iconSize} />
        ) : (
          <span>{first.label}</span>
        )}
      </div>
      {hasMore && (
        <i className={`fas fa-info-circle ${styles.customStatesMore}`} />
      )}
    </div>
  );
}

type PlayerCellImageProps = {
  actions: BCFAction[];
  externalStates: CustomState[];
  diedThisTick: boolean;
  blunder?: boolean;
};

function PlayerCellImage({
  actions,
  diedThisTick,
  blunder,
  externalStates,
}: PlayerCellImageProps) {
  const { cellSize, letterMode, showInventoryTags } = useContext(RenderContext);
  const imageSize = cellSize - 2;

  let baseImage;
  let spellIcon;
  let attackIcon;

  const attack = actions.find((action) => action.type === 'attack');
  const spell = actions.find((action) => action.type === 'spell');

  const customStates: CustomState[] = [];

  if (attack !== undefined) {
    const attackType = bcfToPlayerAttack(attack.attackType);
    const meta =
      ATTACK_METADATA[attackType] ?? ATTACK_METADATA[PlayerAttack.UNKNOWN];

    if (letterMode) {
      baseImage = (
        <div className={styles.letter} style={{ color: meta.tagColor }}>
          {meta.letter}
        </div>
      );
    } else {
      // If a spell was cast alongside an attack, show it as an overlay icon.
      if (spell !== undefined) {
        const spellIconSize = Math.floor(cellSize / 2) + 1;
        spellIcon = getSpellImage(spell, spellIconSize);
      }

      if (attack.damage !== undefined) {
        let weaponName = attack.weaponName;
        if (weaponName === undefined && attack.weaponId !== undefined) {
          weaponName = simpleItemCache.getItemName(attack.weaponId);
        }
        customStates.push({
          label: attack.damage.toString(),
          fullText: weaponName
            ? `${weaponName} hit for ${attack.damage}`
            : `Hit for ${attack.damage}`,
        });
      }

      attackIcon = getAttackIcon(
        attack,
        attackType ?? PlayerAttack.UNKNOWN,
        imageSize,
      );

      baseImage = getWeaponImage(
        attackType ?? PlayerAttack.UNKNOWN,
        attack,
        imageSize,
        showInventoryTags ? meta.tagColor : undefined,
        blunder,
      );
    }
  } else if (spell !== undefined) {
    // Spell-only: show spell as the base image.
    baseImage = getSpellImage(spell, imageSize);
  }

  if (diedThisTick) {
    if (baseImage === undefined) {
      baseImage = (
        <Image
          src="/images/combat/skull.webp"
          alt="Player died"
          height={imageSize}
          width={imageSize}
          style={{ objectFit: 'contain' }}
        />
      );
    } else {
      // Add death at front so it's prioritized when only one state is shown.
      customStates.unshift({
        iconUrl: '/images/combat/skull.webp',
      });
    }
  }

  customStates.push(...externalStates);

  return (
    <div className={styles.playerCellImage}>
      {baseImage}
      <div className={styles.spellIcon}>{spellIcon}</div>
      {attackIcon}
      <CustomStates states={customStates} />
    </div>
  );
}

export type CellProps = {
  rowId: string;
  resolver: BCFResolver;
  tick: number;
  actionEvaluator?: ActionEvaluator;
};

export function Cell({ resolver, rowId, tick, actionEvaluator }: CellProps) {
  const { tooltipId, display, customRows, cellSize, stateProvider } =
    useContext(RenderContext);

  const bgColor = display?.getBackgroundColorAt(tick);
  let cellStyle: React.CSSProperties | undefined = bgColor
    ? {
        backgroundColor: getBackgroundColorVariable(
          bgColor.color,
          bgColor.intensity,
        ),
      }
    : undefined;

  const actor = resolver.getActor(rowId);
  if (actor !== undefined) {
    const cell = resolver.getCell(rowId, tick);
    let className = styles.cell;
    const tooltipProps = {
      'data-tooltip-id': tooltipId,
      'data-tooltip-type': 'actor',
      'data-tooltip-actor-id': actor.id,
      'data-tooltip-tick': tick,
    };

    const externalStates = stateProvider?.(tick, actor.id) ?? [];

    if (actor.type === 'npc') {
      let image;

      const attack = cell?.actions?.find(
        (action) => action.type === 'npcAttack',
      );
      if (attack !== undefined) {
        image = getNpcAttackImage(attack, styles.cellImage);
        className += ` ${styles.npcAttack}`;
      }

      const label = display?.getNpcLabel(rowId, tick);

      return (
        <div className={className} style={cellStyle} {...tooltipProps}>
          {image}
          {label && <span className={styles.cellLabel}>{label}</span>}
          {externalStates.length > 0 && (
            <CustomStates states={externalStates} />
          )}
        </div>
      );
    }

    const state = resolver.getPlayerState(rowId, tick);
    const diedThisTick =
      cell?.actions?.some((action) => action.type === 'death') ?? false;
    const offCooldown = state?.offCooldown ?? false;
    const hasActions = (cell?.actions?.length ?? 0) > 0;

    // Apply dead styling if player has been dead.
    if (state?.isDead && !diedThisTick) {
      className += ` ${styles.playerDead}`;
      cellStyle = undefined; // Override configured background color.
    } else if (offCooldown || hasActions) {
      className += ` ${styles.highlighted}`;
    }

    let evaluation: ActionEvaluation = {};
    for (const action of cell?.actions ?? []) {
      if (actionEvaluator !== undefined) {
        const ev = actionEvaluator(tick, actor.id, action as BCFPlayerAction);
        if (ev !== null) {
          evaluation = mergeEvaluations(evaluation, ev);
        }
      }
    }

    if (evaluation.outline !== undefined) {
      className += ` ${styles[evaluation.outline]}`;
    }

    return (
      <div className={className} style={cellStyle} {...tooltipProps}>
        <PlayerCellImage
          actions={cell?.actions ?? []}
          diedThisTick={diedThisTick}
          blunder={evaluation.blunder}
          externalStates={externalStates}
        />
      </div>
    );
  }

  const customRow = customRows.get(rowId);
  if (customRow !== undefined) {
    const content = customRow.cellRenderer(tick, cellSize - 2);
    let className = styles.cell;
    if (content !== null) {
      className += ` ${styles.highlighted}`;
    }

    const tooltipProps =
      content !== null && customRow.tooltipRenderer !== undefined
        ? {
            'data-tooltip-id': tooltipId,
            'data-tooltip-type': 'custom',
            'data-tooltip-row-id': rowId,
            'data-tooltip-tick': tick,
          }
        : {};

    return (
      <div className={className} style={cellStyle} {...tooltipProps}>
        {content}
      </div>
    );
  }

  return <div className={styles.cell} style={cellStyle} />;
}
