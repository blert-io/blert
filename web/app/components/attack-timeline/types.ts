import { BCFPlayerAction } from '@blert/bcf';
import React, { createContext } from 'react';

import type { TimelineDisplay } from './display-utils';

export type ChartColor =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'purple'
  | 'gray';

export type ColorIntensity = 'low' | 'medium' | 'high';

export type BackgroundColor = {
  color: ChartColor;
  intensity: ColorIntensity;
  startTick: number;
  endTick: number;
};

export type CustomState = {
  label?: string;
  iconUrl?: string;
  fullText?: string;
};

export type TimelineSplit = {
  tick: number;
  splitName: string;
  unimportant?: boolean;
};

export type CustomRow = {
  name: string;
  cellRenderer: (tick: number, size: number) => React.ReactNode;
  tooltipRenderer?: (tick: number) => React.ReactNode | null;
};

/** Maps BCF color and intensity tokens to CSS background color variables. */
export function getBackgroundColorVariable(
  color: ChartColor,
  intensity: ColorIntensity,
): string {
  return `var(--bcf-color-${color}-${intensity})`;
}

export type StateProvider = (
  tick: number,
  actorId: string,
) => CustomState[] | null;

export type RenderContext = {
  cellSize: number;
  letterMode: boolean;
  showInventoryTags: boolean;
  tooltipId: string;
  display: TimelineDisplay | null;
  customRows: Map<string, CustomRow>;
  stateProvider?: StateProvider;
};

export const RenderContext = createContext<RenderContext>({
  cellSize: 30,
  letterMode: false,
  showInventoryTags: false,
  tooltipId: '',
  display: null,
  customRows: new Map(),
});

export type ActionOutline = 'success' | 'warning' | 'danger' | 'neutral';

export type ActionEvaluation = {
  outline?: ActionOutline;
  blunder?: boolean;
};

export type ActionEvaluator = (
  tick: number,
  actorId: string,
  action: BCFPlayerAction,
) => ActionEvaluation | null;

export const ACTION_OUTLINE_PRIORITY: Record<ActionOutline, number> = {
  danger: 3,
  warning: 2,
  success: 1,
  neutral: 0,
};

export function mergeEvaluations(
  a: ActionEvaluation,
  b: ActionEvaluation,
): ActionEvaluation {
  const aOutlinePriority = a.outline ? ACTION_OUTLINE_PRIORITY[a.outline] : -1;
  const bOutlinePriority = b.outline ? ACTION_OUTLINE_PRIORITY[b.outline] : -1;

  return {
    outline: aOutlinePriority >= bOutlinePriority ? a.outline : b.outline,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    blunder: a.blunder || b.blunder,
  };
}

// Layout constants injected into CSS and used for indicator calculations.
export const SCROLLABLE_PADDING_TOP = 75;
export const SCROLLABLE_PADDING_LEFT = 12;
export const TICK_HEIGHT = 30;
export const CELL_GAP = 5;
export const ROW_MARGIN = 50;

// Derived indicator positioning values.
export const INDICATOR_INITIAL_Y = SCROLLABLE_PADDING_TOP - 8;
export const INDICATOR_LEFT_ADJUST = 3;
export const INDICATOR_ROW_EXTRA = 23.5;

// Legend dimensions.
export const LEGEND_WIDTH = 134;
export const LEGEND_WIDTH_RESERVED = 140;
export const LEGEND_WIDTH_SMALL = 50;
export const LEGEND_WIDTH_SMALL_RESERVED = 75;

// Auto-scroll defaults: minimum columns before scrolling, columns kept in view.
export const DEFAULT_SCROLL_MIN_COLUMNS = 15;
export const DEFAULT_SCROLL_VISIBLE_COLUMNS = 10;
