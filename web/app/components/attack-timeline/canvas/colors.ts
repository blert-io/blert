/**
 * Hardcoded color constants for the canvas timeline renderer.
 *
 * These mirror the CSS variables defined in `bcf-renderer.module.scss` and
 * `globals.scss`. Since canvas cannot efficiently read CSS variables, and the
 * app does not support runtime theme switching, hardcoding is safe.
 *
 * If the theme changes, these values must be updated to match.
 */

import { ChartColor, ColorIntensity } from '../types';

const BCF_COLORS: Record<ChartColor, Record<ColorIntensity, string>> = {
  red: {
    low: 'rgba(160, 80, 80, 0.2)',
    medium: 'rgba(120, 50, 50, 0.45)',
    high: 'rgba(80, 32, 32, 0.7)',
  },
  orange: {
    low: 'rgba(220, 140, 70, 0.25)',
    medium: 'rgba(210, 130, 60, 0.45)',
    high: 'rgba(200, 120, 50, 0.7)',
  },
  yellow: {
    low: 'rgba(240, 230, 140, 0.25)',
    medium: 'rgba(230, 215, 100, 0.45)',
    high: 'rgba(222, 200, 88, 0.7)',
  },
  green: {
    low: 'rgba(100, 180, 100, 0.25)',
    medium: 'rgba(80, 160, 85, 0.45)',
    high: 'rgba(64, 147, 67, 0.7)',
  },
  cyan: {
    low: 'rgba(100, 220, 235, 0.25)',
    medium: 'rgba(85, 210, 225, 0.45)',
    high: 'rgba(66, 198, 215, 0.7)',
  },
  blue: {
    low: 'rgba(100, 160, 255, 0.25)',
    medium: 'rgba(80, 145, 250, 0.45)',
    high: 'rgba(59, 130, 246, 0.7)',
  },
  purple: {
    low: 'rgba(130, 140, 255, 0.25)',
    medium: 'rgba(110, 120, 250, 0.45)',
    high: 'rgba(88, 101, 242, 0.7)',
  },
  gray: {
    low: 'rgba(190, 190, 195, 0.25)',
    medium: 'rgba(180, 180, 180, 0.45)',
    high: 'rgba(169, 170, 171, 0.7)',
  },
};

/** Maps a BCF chart color + intensity to a canvas fill style string. */
export function getChartColor(
  color: ChartColor,
  intensity: ColorIntensity,
): string {
  return BCF_COLORS[color][intensity];
}

// Cell backgrounds

export const CELL_BG_DEFAULT = 'rgba(33, 35, 48, 0.4)';
export const CELL_BG_DEFAULT_HOVER = 'rgba(33, 35, 48, 0.7)';

export const CELL_BG_HIGHLIGHTED = 'rgba(48, 51, 73, 0.5)';
export const CELL_BG_HIGHLIGHTED_HOVER = 'rgba(88, 101, 242, 0.3)';

export const CELL_BG_NPC_ATTACK = 'rgba(239, 68, 68, 0.1)';
export const CELL_BG_NPC_ATTACK_HOVER = 'rgba(239, 68, 68, 0.3)';

export const CELL_BG_DEAD = 'rgba(239, 68, 68, 0.15)';
export const CELL_BG_DEAD_HOVER = 'rgba(239, 68, 68, 0.3)';

export const CELL_DEAD_OPACITY = 0.25;
export const CELL_DEAD_HOVER_OPACITY = 0.4;

// Cell outlines

export const OUTLINE_SUCCESS = 'rgba(45, 199, 112, 0.25)';
export const OUTLINE_SUCCESS_HOVER = 'rgba(45, 199, 112, 0.75)';

export const OUTLINE_WARNING = 'rgba(222, 200, 88, 0.5)';
export const OUTLINE_WARNING_HOVER = 'rgba(222, 200, 88, 0.9)';

export const OUTLINE_DANGER = 'rgba(239, 68, 68, 0.5)';
export const OUTLINE_DANGER_HOVER = 'rgba(239, 68, 68, 0.9)';

export const OUTLINE_NEUTRAL = 'rgba(195, 199, 201, 0.2)';
export const OUTLINE_NEUTRAL_HOVER = 'rgba(88, 101, 242, 0.8)';

export const OUTLINE_HOVER = 'rgba(88, 101, 242, 0.7)';

export const OUTLINE_NPC_ATTACK_HOVER = 'rgba(239, 68, 68, 0.9)';

// Text colors

export const TEXT_TICK_HEADER = 'rgb(94, 98, 136)';
export const TEXT_PRIMARY = 'rgb(195, 199, 201)';
export const TEXT_NPC_ATTACK = 'rgba(239, 68, 68, 0.9)';
export const TEXT_HIGHLIGHTED = 'rgba(88, 101, 242, 0.9)';

export const BLERT_PURPLE = 'rgb(88, 101, 242)';
