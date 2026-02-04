'use client';

import { BCFResolver, BlertChartFormat } from '@blert/bcf';
import { useEffect, useMemo, useRef } from 'react';

import HorizontalScrollable from '@/components/horizontal-scrollable';

import { BcfTooltip, BCF_TOOLTIP_ID } from './bcf-tooltip';
import { defaultRowOrder, TimelineDisplay } from './display-utils';
import { CoreTimelineRenderer } from './timeline';
import {
  ActionEvaluator,
  CELL_GAP,
  CustomRow,
  DEFAULT_SCROLL_MIN_COLUMNS,
  DEFAULT_SCROLL_VISIBLE_COLUMNS,
  INDICATOR_INITIAL_Y,
  INDICATOR_LEFT_ADJUST,
  INDICATOR_ROW_EXTRA,
  LEGEND_WIDTH,
  LEGEND_WIDTH_RESERVED,
  LEGEND_WIDTH_SMALL,
  LEGEND_WIDTH_SMALL_RESERVED,
  RenderContext,
  ROW_MARGIN,
  SCROLLABLE_PADDING_LEFT,
  SCROLLABLE_PADDING_TOP,
  StateProvider,
  TICK_HEIGHT,
} from './types';

import styles from './bcf-renderer.module.scss';

export type {
  ActionEvaluation,
  ActionEvaluator,
  ActionOutline,
  CustomRow,
  CustomState,
  StateProvider,
} from './types';

export type BcfRendererProps = {
  bcf: BlertChartFormat;
  cellSize: number;
  wrapWidth?: number;
  smallLegend?: boolean;
  letterMode?: boolean;
  showInventoryTags?: boolean;
  actionEvaluator?: ActionEvaluator;
  stateProvider?: StateProvider;

  /** Custom rows rendered between NPC and player rows. */
  customRows?: CustomRow[];

  /** Actor to highlight in the legend. */
  selectedActorId?: string;

  /** Callback for when an actor is selected. */
  onActorSelect?: (actorId: string) => void;

  /** Current tick for playback indicator. If set, shows active column. */
  currentTick?: number;

  /** Callback for when a tick is selected. */
  onTickSelect?: (tick: number) => void;

  /** Minimum columns before auto-scroll activates. Default: 15. */
  scrollMinColumns?: number;

  /** Columns kept visible to the left when auto-scrolling. Default: 10. */
  scrollVisibleColumns?: number;

  /**
   * Tooltip ID for external tooltip handling. If not provided, a default
   * tooltip is rendered with BCF spec only data.
   */
  tooltipId?: string;
};

export function BcfRenderer({
  bcf,
  cellSize,
  wrapWidth,
  smallLegend = false,
  letterMode = false,
  showInventoryTags = false,
  actionEvaluator,
  stateProvider,
  customRows: customRowsProp,
  selectedActorId,
  currentTick,
  scrollMinColumns = DEFAULT_SCROLL_MIN_COLUMNS,
  scrollVisibleColumns = DEFAULT_SCROLL_VISIBLE_COLUMNS,
  tooltipId,
  onActorSelect,
  onTickSelect,
}: BcfRendererProps) {
  const resolver = useMemo(() => new BCFResolver(bcf), [bcf]);

  const customRowsMap = useMemo(() => {
    const map = new Map<string, CustomRow>();
    customRowsProp?.forEach((row, i) => map.set(`custom:${i}`, row));
    return map;
  }, [customRowsProp]);

  const rowOrder = useMemo(() => {
    const baseOrder = resolver.getRowOrder() ?? defaultRowOrder(resolver);
    if (customRowsMap.size === 0) {
      return baseOrder;
    }

    // Insert custom rows before the first player.
    const customIds = Array.from(customRowsMap.keys());
    const firstPlayerIndex = baseOrder.findIndex(
      (id) => resolver.getActor(id)?.type === 'player',
    );

    if (firstPlayerIndex === -1) {
      return [...baseOrder, ...customIds];
    }

    return [
      ...baseOrder.slice(0, firstPlayerIndex),
      ...customIds,
      ...baseOrder.slice(firstPlayerIndex),
    ];
  }, [resolver, customRowsMap]);

  const scrollableRef = useRef<HTMLDivElement | null>(null);

  const totalColumnWidth = cellSize + CELL_GAP;
  const shouldScroll = wrapWidth === undefined;

  let ticksPerRow = resolver.totalTicks;
  let numRows = 1;

  if (wrapWidth !== undefined) {
    const legendReserved = smallLegend
      ? LEGEND_WIDTH_SMALL_RESERVED
      : LEGEND_WIDTH_RESERVED;
    const timelineWidth = wrapWidth - legendReserved;
    ticksPerRow = Math.max(
      1,
      Math.floor(timelineWidth / (cellSize + CELL_GAP)),
    );
    numRows = Math.ceil(resolver.displayTicks / ticksPerRow);
  }

  // Auto-scroll to current tick when playing.
  useEffect(() => {
    if (!shouldScroll || currentTick === undefined) {
      return;
    }

    if (scrollableRef.current !== null) {
      const tickOffset = currentTick - resolver.startTick;
      const scrollThreshold = scrollMinColumns * totalColumnWidth;
      const scrollOffset = scrollVisibleColumns * totalColumnWidth + cellSize;

      if (tickOffset * totalColumnWidth < scrollThreshold) {
        scrollableRef.current.scrollLeft = 0;
      } else {
        scrollableRef.current.scrollLeft =
          tickOffset * totalColumnWidth - scrollOffset;
      }
    }
  }, [
    shouldScroll,
    currentTick,
    totalColumnWidth,
    cellSize,
    scrollMinColumns,
    scrollVisibleColumns,
    resolver.startTick,
  ]);

  const memoizedCoreTimeline = useMemo(
    () => (
      <CoreTimelineRenderer
        resolver={resolver}
        rowOrder={rowOrder}
        numRows={numRows}
        ticksPerRow={ticksPerRow}
        onTickSelect={onTickSelect}
        actionEvaluator={actionEvaluator}
      />
    ),
    [resolver, rowOrder, numRows, ticksPerRow, onTickSelect, actionEvaluator],
  );

  const legendElements = rowOrder.map((actorId) => {
    const actor = resolver.getActor(actorId);
    if (actor !== undefined) {
      const isSelected = actorId === selectedActorId;
      let className = `${styles.legendParticipant} ${styles[actor.type]}`;
      if (isSelected) {
        className += ` ${styles.selected}`;
      }

      if (onActorSelect !== undefined) {
        return (
          <button
            key={actorId}
            className={className}
            onClick={() => onActorSelect(actorId)}
          >
            {smallLegend ? actor.name[0] : actor.name}
          </button>
        );
      }

      return (
        <div key={actorId} className={className}>
          {smallLegend ? actor.name[0] : actor.name}
        </div>
      );
    }
    const customRow = customRowsMap.get(actorId);
    if (customRow !== undefined) {
      return (
        <div
          key={actorId}
          className={`${styles.legendParticipant} ${styles.custom}`}
        >
          {smallLegend ? customRow.name[0] : customRow.name}
        </div>
      );
    }

    return null;
  });

  const effectiveTooltipId = tooltipId ?? BCF_TOOLTIP_ID;

  const display = useMemo(() => new TimelineDisplay(resolver), [resolver]);

  const renderContext = useMemo(
    () => ({
      cellSize,
      letterMode,
      showInventoryTags,
      tooltipId: effectiveTooltipId,
      display,
      customRows: customRowsMap,
      stateProvider,
    }),
    [
      cellSize,
      letterMode,
      showInventoryTags,
      effectiveTooltipId,
      display,
      customRowsMap,
      stateProvider,
    ],
  );

  // Calculate active column indicator position.
  let indicatorStyle: React.CSSProperties | undefined;
  if (currentTick !== undefined) {
    const tickOffset = currentTick - resolver.startTick;
    const row = Math.floor(tickOffset / ticksPerRow);
    const tickOnRow = tickOffset % ticksPerRow;

    // Total indicator height covers tick header + cells + top extension.
    const cellsHeight = rowOrder.length * (cellSize + CELL_GAP);
    const indicatorHeight =
      TICK_HEIGHT +
      cellsHeight +
      (SCROLLABLE_PADDING_TOP - INDICATOR_INITIAL_Y);

    const x =
      totalColumnWidth * tickOnRow +
      SCROLLABLE_PADDING_LEFT -
      INDICATOR_LEFT_ADJUST;
    const y =
      INDICATOR_INITIAL_Y +
      row * (cellsHeight + INDICATOR_INITIAL_Y + INDICATOR_ROW_EXTRA);

    indicatorStyle = {
      transform: `translate(${x}px, ${y}px)`,
      height: indicatorHeight,
      width: totalColumnWidth + 1,
    };
  }

  return (
    <RenderContext.Provider value={renderContext}>
      <div
        className={styles.bcfRenderer}
        style={
          {
            '--cell-size': `${cellSize}px`,
            '--bcf-scrollable-padding-top': `${SCROLLABLE_PADDING_TOP}px`,
            '--bcf-scrollable-padding-left': `${SCROLLABLE_PADDING_LEFT}px`,
            '--bcf-tick-height': `${TICK_HEIGHT}px`,
            '--bcf-cell-gap': `${CELL_GAP}px`,
            '--bcf-row-margin': `${ROW_MARGIN}px`,
          } as React.CSSProperties
        }
      >
        <div
          className={styles.legend}
          style={{ width: smallLegend ? LEGEND_WIDTH_SMALL : LEGEND_WIDTH }}
        >
          {Array.from({ length: numRows }).map((_, i) => (
            <div className={styles.legendRow} key={i}>
              {legendElements}
            </div>
          ))}
        </div>
        <HorizontalScrollable
          className={styles.scrollable}
          customRef={scrollableRef}
          disable={!shouldScroll}
        >
          {indicatorStyle && (
            <div
              style={indicatorStyle}
              className={styles.columnActiveIndicator}
            />
          )}
          {memoizedCoreTimeline}
        </HorizontalScrollable>
        {tooltipId === undefined && (
          <BcfTooltip resolver={resolver} onActorSelect={onActorSelect} />
        )}
      </div>
    </RenderContext.Provider>
  );
}
