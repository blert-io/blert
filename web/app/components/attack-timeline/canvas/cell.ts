import { ActionOutline } from '../types';

import {
  CELL_BG_DEFAULT,
  CELL_BG_DEFAULT_HOVER,
  CELL_BG_DEAD,
  CELL_BG_DEAD_HOVER,
  CELL_BG_HIGHLIGHTED,
  CELL_BG_HIGHLIGHTED_HOVER,
  CELL_BG_NPC_ATTACK,
  CELL_BG_NPC_ATTACK_HOVER,
  CELL_DEAD_HOVER_OPACITY,
  CELL_DEAD_OPACITY,
  OUTLINE_DANGER,
  OUTLINE_DANGER_HOVER,
  OUTLINE_HOVER,
  OUTLINE_NEUTRAL,
  OUTLINE_NEUTRAL_HOVER,
  OUTLINE_NPC_ATTACK_HOVER,
  OUTLINE_SUCCESS,
  OUTLINE_SUCCESS_HOVER,
  OUTLINE_WARNING,
  OUTLINE_WARNING_HOVER,
} from './colors';
import { Point } from './types';

export type CellCategory = 'default' | 'highlighted' | 'npcAttack' | 'dead';

export type CellStyle = {
  /** Fill color for the cell background. */
  background: string;
  /** Stroke color for the 1px outline. Transparent if omitted. */
  outline?: string;
  /** Optional global alpha override. */
  opacity?: number;
};

const BG_NORMAL: Record<CellCategory, string> = {
  default: CELL_BG_DEFAULT,
  highlighted: CELL_BG_HIGHLIGHTED,
  npcAttack: CELL_BG_NPC_ATTACK,
  dead: CELL_BG_DEAD,
};

const BG_HOVER: Record<CellCategory, string> = {
  default: CELL_BG_DEFAULT_HOVER,
  highlighted: CELL_BG_HIGHLIGHTED_HOVER,
  npcAttack: CELL_BG_NPC_ATTACK_HOVER,
  dead: CELL_BG_DEAD_HOVER,
};

const OUTLINE_NORMAL: Record<ActionOutline, string> = {
  success: OUTLINE_SUCCESS,
  warning: OUTLINE_WARNING,
  danger: OUTLINE_DANGER,
  neutral: OUTLINE_NEUTRAL,
};

const OUTLINE_HOVER_MAP: Record<ActionOutline, string> = {
  success: OUTLINE_SUCCESS_HOVER,
  warning: OUTLINE_WARNING_HOVER,
  danger: OUTLINE_DANGER_HOVER,
  neutral: OUTLINE_NEUTRAL_HOVER,
};

/**
 * Resolves the visual style for a cell based on its category, action evaluation
 * outline, and hover state.
 *
 * @param category The type of cell.
 * @param outline Optional evaluation outline.
 * @param isHovered Whether the cell is hovered.
 * @param chartBackground Optional background color override from
 *    `TimelineDisplay` (chart color band).
 * @returns The styling for the cell, to be used in `drawCell`.
 */
export function resolveCellStyle(
  category: CellCategory,
  outline: ActionOutline | undefined,
  isHovered: boolean,
  chartBackground: string | undefined,
): CellStyle {
  const isDead = category === 'dead';

  let background: string;
  if (isDead) {
    // Dead cells override chart background colors.
    background = isHovered ? BG_HOVER.dead : BG_NORMAL.dead;
  } else if (chartBackground !== undefined) {
    background = chartBackground;
  } else {
    background = isHovered ? BG_HOVER[category] : BG_NORMAL[category];
  }

  let resolvedOutline: string | undefined;
  if (isHovered) {
    if (outline !== undefined) {
      resolvedOutline = OUTLINE_HOVER_MAP[outline];
    } else if (category === 'npcAttack') {
      resolvedOutline = OUTLINE_NPC_ATTACK_HOVER;
    } else {
      resolvedOutline = OUTLINE_HOVER;
    }
  } else if (outline !== undefined) {
    resolvedOutline = OUTLINE_NORMAL[outline];
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
