'use client';

import { createContext, useContext } from 'react';

import { CELL_GAP, TICK_HEIGHT } from './types';

import styles from './bcf-renderer.module.scss';

export type VisualRow = {
  startTick: number;
  endTick: number;
  rowOrder: string[];
  cellSize: number;
};

export const VisualRowContext = createContext<VisualRow | null>(null);

/** The overlays provided by the caller. */
export const OverlayContext = createContext<React.ReactNode>(null);

export function OverlayPlane(props: VisualRow) {
  const overlays = useContext(OverlayContext);
  if (overlays === null) {
    return null;
  }

  return (
    <VisualRowContext.Provider value={props}>
      <div className={styles.overlayPlane}>{overlays}</div>
    </VisualRowContext.Provider>
  );
}

export type CellOverlayProps = {
  children?: React.ReactNode;
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
  rowId: string;
  tick: number;
};

/** Positions content over a cell of a timeline. */
export function CellOverlay({
  children,
  className,
  ref,
  rowId,
  tick,
}: CellOverlayProps) {
  const row = useContext(VisualRowContext);
  if (row === null || tick < row.startTick || tick > row.endTick) {
    return null;
  }

  const rowIndex = row.rowOrder.indexOf(rowId);
  if (rowIndex === -1) {
    return null;
  }

  const columnWidth = row.cellSize + CELL_GAP;
  return (
    <div
      className={className}
      ref={ref}
      style={{
        position: 'absolute',
        left: (tick - row.startTick) * columnWidth,
        top: TICK_HEIGHT + rowIndex * columnWidth,
        width: row.cellSize,
        height: row.cellSize,
      }}
    >
      {children}
    </div>
  );
}

export type RegionOverlayProps = {
  children?: React.ReactNode;
  className?: string;
  endRowId: string;
  endTick: number;
  startRowId: string;
  startTick: number;
};

/**
 * Places content over the rows between `startRowId` and `endRowId` and ticks
 * between `startTick` and `endTick`, inclusive, wrapping across visual rows.
 */
export function RegionOverlay({
  children,
  className,
  endRowId,
  endTick,
  startRowId,
  startTick,
}: RegionOverlayProps) {
  const row = useContext(VisualRowContext);
  if (row === null) {
    return null;
  }

  const firstTick = Math.max(Math.min(startTick, endTick), row.startTick);
  const lastTick = Math.min(Math.max(startTick, endTick), row.endTick);
  const startIndex = row.rowOrder.indexOf(startRowId);
  const endIndex = row.rowOrder.indexOf(endRowId);
  if (firstTick > lastTick || startIndex === -1 || endIndex === -1) {
    return null;
  }

  const firstRow = Math.min(startIndex, endIndex);
  const lastRow = Math.max(startIndex, endIndex);
  const columnWidth = row.cellSize + CELL_GAP;
  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        left: (firstTick - row.startTick) * columnWidth,
        top: TICK_HEIGHT + firstRow * columnWidth,
        width: (lastTick - firstTick + 1) * columnWidth - CELL_GAP,
        height: (lastRow - firstRow + 1) * columnWidth - CELL_GAP,
      }}
    >
      {children}
    </div>
  );
}
