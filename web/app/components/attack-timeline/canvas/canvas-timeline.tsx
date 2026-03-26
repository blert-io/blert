'use client';

import { BCFResolver } from '@blert/bcf';
import { memo, useEffect, useMemo, useRef } from 'react';

import { TimelineDisplay } from '../display-utils';
import {
  ActionEvaluator,
  CELL_GAP,
  CustomRow,
  ROW_PADDING_BOTTOM,
  StateProvider,
  TICK_HEIGHT,
} from '../types';

import {
  ControllerData,
  ControllerLayout,
  TimelineController,
  TileInfo,
} from './timeline-controller';

import styles from '../bcf-renderer.module.scss';

const MAX_TILE_WIDTH = 4096;

export type CanvasTimelineProps = {
  resolver: BCFResolver;
  display: TimelineDisplay;
  rowOrder: string[];
  numRows: number;
  ticksPerRow: number;
  cellSize: number;
  actionEvaluator?: ActionEvaluator;
  stateProvider?: StateProvider;
  customRows: Map<string, CustomRow>;
  letterMode: boolean;
  showInventoryTags: boolean;
  tooltipId: string;
  onTickSelect?: (tick: number) => void;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
};

function computeTiles(
  startTick: number,
  totalTicks: number,
  cellSize: number,
  ticksPerTile: number,
): TileInfo[] {
  const tiles: TileInfo[] = [];

  const columnWidth = cellSize + CELL_GAP;
  let remaining = totalTicks;
  let tick = startTick;

  while (remaining > 0) {
    const count = Math.min(remaining, ticksPerTile);
    const logicalWidth = count * columnWidth;

    tiles.push({
      startTick: tick,
      tickCount: count,
      logicalWidth,
    });

    tick += count;
    remaining -= count;
  }

  return tiles;
}

export const CanvasTimeline = memo(function CanvasTimeline({
  resolver,
  display,
  rowOrder,
  numRows,
  ticksPerRow,
  cellSize,
  actionEvaluator,
  stateProvider,
  customRows,
  letterMode,
  showInventoryTags,
  tooltipId,
  onTickSelect,
  scrollContainerRef,
}: CanvasTimelineProps) {
  const columnWidth = cellSize + CELL_GAP;
  const ticksPerTile = Math.max(1, Math.floor(MAX_TILE_WIDTH / columnWidth));

  const canvasHeight =
    TICK_HEIGHT + rowOrder.length * columnWidth + ROW_PADDING_BOTTOM;

  // Compute tile layout for all rows.
  const allTiles = useMemo(() => {
    const rows: TileInfo[][] = [];
    for (let row = 0; row < numRows; row++) {
      const rowStart = resolver.startTick + row * ticksPerRow;
      const rowTicks = Math.min(ticksPerRow, resolver.endTick - rowStart + 1);
      if (rowTicks <= 0) {
        break;
      }
      rows.push(computeTiles(rowStart, rowTicks, cellSize, ticksPerTile));
    }
    return rows;
  }, [resolver, numRows, ticksPerRow, cellSize, ticksPerTile]);

  const flatTiles = useMemo(() => allTiles.flat(), [allTiles]);

  // Set of active ticks in each custom row to highlight cells.
  const customRowContent = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const [rowId, row] of customRows) {
      const ticks = new Set<number>();
      for (let t = resolver.startTick; t <= resolver.endTick; t++) {
        if (row.cellRenderer(t, cellSize - 2) !== null) {
          ticks.add(t);
        }
      }
      map.set(rowId, ticks);
    }
    return map;
  }, [customRows, resolver, cellSize]);

  const canvasRefs = useRef<HTMLCanvasElement[]>([]);

  const controllerRef = useRef<TimelineController | null>(null);
  controllerRef.current ??= new TimelineController();

  const data: ControllerData = {
    resolver,
    display,
    actionEvaluator,
    stateProvider,
    letterMode,
    showInventoryTags,
    customRowContent,
    onTickSelect,
    tooltipId,
  };

  const layout: ControllerLayout = {
    tiles: flatTiles,
    cellSize,
    rowOrder,
  };

  controllerRef.current.update(data, layout);

  useEffect(() => {
    controllerRef.current?.setCanvases(canvasRefs.current);
    controllerRef.current?.setScrollContainer(
      scrollContainerRef?.current ?? null,
    );
  });

  useEffect(() => {
    return () => controllerRef.current?.destroy();
  }, []);

  let tileIndex = 0;

  return (
    <>
      {allTiles.map((rowTiles, rowIdx) => (
        <div
          key={rowIdx}
          className={styles.row}
          style={{ position: 'relative', gap: 0 }}
        >
          {rowTiles.map((tile) => {
            const idx = tileIndex++;

            return (
              <canvas
                key={idx}
                ref={(el) => {
                  if (el !== null) {
                    canvasRefs.current[idx] = el;
                  }
                }}
                style={{
                  width: tile.logicalWidth,
                  height: canvasHeight,
                }}
              />
            );
          })}

          {/* Split marker DOM overlays */}
          {rowTiles.map((tile, tileInRow) => {
            const tileOffsetX = rowTiles
              .slice(0, tileInRow)
              .reduce((sum, t) => sum + t.logicalWidth, 0);

            const splits: React.ReactNode[] = [];
            for (let col = 0; col < tile.tickCount; col++) {
              const tick = tile.startTick + col;
              const splitName = display.getSplitNameAt(tick);
              if (splitName === undefined) {
                continue;
              }

              const colX = tileOffsetX + col * columnWidth;

              splits.push(
                <div
                  key={`split-${tick}`}
                  className={styles.column}
                  style={{
                    position: 'absolute',
                    left: colX,
                    top: 0,
                    width: cellSize,
                    height: canvasHeight,
                    pointerEvents: 'none',
                  }}
                >
                  <div className={styles.split}>
                    <span className={styles.splitName}>{splitName}</span>
                    <div className={styles.splitIndicator}>
                      <div className={styles.splitLine} />
                      <div className={styles.splitTail} />
                    </div>
                  </div>
                  <div className={`${styles.split} ${styles.splitBottom}`}>
                    <div className={styles.splitIndicator}>
                      <div className={styles.splitLine} />
                    </div>
                  </div>
                </div>,
              );
            }
            return splits;
          })}

          {/* Custom row content overlays */}
          {rowOrder.map((rowId, rowIndex) => {
            const customRow = customRows.get(rowId);
            if (customRow === undefined) {
              return null;
            }

            const rowY = TICK_HEIGHT + rowIndex * columnWidth;

            return rowTiles.map((tile, tileInRow) => {
              const tileOffsetX = rowTiles
                .slice(0, tileInRow)
                .reduce((sum, t) => sum + t.logicalWidth, 0);

              const cells: React.ReactNode[] = [];
              for (let col = 0; col < tile.tickCount; col++) {
                const tick = tile.startTick + col;
                const content = customRow.cellRenderer(tick, cellSize - 2);
                if (content === null) {
                  continue;
                }

                const colX = tileOffsetX + col * columnWidth;
                let tooltipProps = {};
                if (customRow.tooltipRenderer !== undefined) {
                  tooltipProps = {
                    'data-tooltip-id': tooltipId,
                    'data-tooltip-type': 'custom',
                    'data-tooltip-row-id': rowId,
                    'data-tooltip-tick': tick,
                  };
                }

                cells.push(
                  <div
                    key={`${rowId}-${tick}`}
                    style={{
                      position: 'absolute',
                      left: colX,
                      top: rowY,
                      width: cellSize,
                      height: cellSize,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      pointerEvents: 'none',
                    }}
                    {...tooltipProps}
                  >
                    {content}
                  </div>,
                );
              }
              return cells;
            });
          })}
        </div>
      ))}
    </>
  );
});
