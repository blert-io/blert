import { ActionOutline } from '../types';

import {
  CELL_BG_DEAD,
  CELL_BG_DEAD_HOVER,
  CELL_BG_NPC_ATTACK,
  CELL_BG_NPC_ATTACK_HOVER,
  CELL_DEAD_HOVER_OPACITY,
  CELL_DEAD_OPACITY,
  OUTLINE_DANGER,
  OUTLINE_DANGER_HOVER,
  OUTLINE_NPC_ATTACK_HOVER,
  OUTLINE_SUCCESS,
  OUTLINE_SUCCESS_HOVER,
  OUTLINE_WARNING,
  OUTLINE_WARNING_HOVER,
} from './colors';
import { TimelinePalette } from './palette';
import { Point } from './types';

export type CellCategory =
  | 'default'
  | 'offCooldown'
  | 'action'
  | 'npcAttack'
  | 'dead';

export type CellStyle = {
  /** Fill color for the cell background. */
  background: string;
  /** Stroke color for the 1px outline. Transparent if omitted. */
  outline?: string;
  /** Optional global alpha override. */
  opacity?: number;
};

/** Background for a non-dead cell category, honoring hover state. */
function categoryBackground(
  palette: TimelinePalette,
  category: CellCategory,
  isHovered: boolean,
): string {
  switch (category) {
    case 'default':
      return isHovered ? palette.cellBgDefaultHover : palette.cellBgDefault;
    case 'action':
      return isHovered ? palette.cellBgActionHover : palette.cellBgAction;
    case 'offCooldown':
      return isHovered
        ? palette.cellBgOffCooldownHover
        : palette.cellBgOffCooldown;
    case 'npcAttack':
      return isHovered ? CELL_BG_NPC_ATTACK_HOVER : CELL_BG_NPC_ATTACK;
    case 'dead':
      return isHovered ? CELL_BG_DEAD_HOVER : CELL_BG_DEAD;
  }
}

/** Outline color for an evaluation outline, honoring hover state. */
function outlineColor(
  palette: TimelinePalette,
  outline: ActionOutline,
  isHovered: boolean,
): string {
  switch (outline) {
    case 'success':
      return isHovered ? OUTLINE_SUCCESS_HOVER : OUTLINE_SUCCESS;
    case 'warning':
      return isHovered ? OUTLINE_WARNING_HOVER : OUTLINE_WARNING;
    case 'danger':
      return isHovered ? OUTLINE_DANGER_HOVER : OUTLINE_DANGER;
    case 'neutral':
      return isHovered ? palette.outlineNeutralHover : palette.outlineNeutral;
  }
}

/**
 * Resolves the visual style for a cell based on its category, action evaluation
 * outline, and hover state.
 *
 * @param palette The active decorative palette.
 * @param category The type of cell.
 * @param outline Optional evaluation outline.
 * @param isHovered Whether the cell is hovered.
 * @param chartBackground Optional background color override from
 *    `TimelineDisplay` (chart color band).
 * @returns The styling for the cell, to be used in `drawCell`.
 */
export function resolveCellStyle(
  palette: TimelinePalette,
  category: CellCategory,
  outline: ActionOutline | undefined,
  isHovered: boolean,
  chartBackground: string | undefined,
): CellStyle {
  const isDead = category === 'dead';

  let background: string;
  if (isDead) {
    // Dead cells override chart background colors.
    background = isHovered ? CELL_BG_DEAD_HOVER : CELL_BG_DEAD;
  } else if (chartBackground !== undefined) {
    background = chartBackground;
  } else {
    background = categoryBackground(palette, category, isHovered);
  }

  let resolvedOutline: string | undefined;
  if (isHovered) {
    if (outline !== undefined) {
      resolvedOutline = outlineColor(palette, outline, true);
    } else if (category === 'npcAttack') {
      resolvedOutline = OUTLINE_NPC_ATTACK_HOVER;
    } else {
      resolvedOutline = palette.outlineHover;
    }
  } else if (outline !== undefined) {
    resolvedOutline = outlineColor(palette, outline, false);
  }

  return {
    background,
    outline: resolvedOutline,
    opacity: isDead
      ? isHovered
        ? CELL_DEAD_HOVER_OPACITY
        : CELL_DEAD_OPACITY
      : undefined,
  };
}

const CELL_RADIUS = 4;

/**
 * Draws a timeline cell's frame, consisting of a background rectangle with
 * an optional outline. Does not draw cell content.
 *
 * @param ctx Canvas context.
 * @param pos The top-left position of the cell.
 * @param size Size of the cell, in pixels.
 * @param style Styling configuration for the cell.
 */
export function drawCell(
  ctx: CanvasRenderingContext2D,
  pos: Point,
  size: number,
  style: CellStyle,
): void {
  const prevAlpha = ctx.globalAlpha;
  if (style.opacity !== undefined) {
    ctx.globalAlpha = style.opacity;
  }

  ctx.fillStyle = style.background;
  ctx.beginPath();
  ctx.roundRect(pos.x, pos.y, size, size, CELL_RADIUS);
  ctx.fill();

  if (style.outline !== undefined) {
    ctx.strokeStyle = style.outline;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (style.opacity !== undefined) {
    ctx.globalAlpha = prevAlpha;
  }
}
