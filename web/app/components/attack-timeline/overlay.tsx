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
  rowId: string;
  tick: number;
  className?: string;
  children?: React.ReactNode;
  ref?: React.Ref<HTMLDivElement>;
};

/** Positions content over a cell of a timeline. */
export function CellOverlay({
  rowId,
  tick,
  className,
  children,
  ref,
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
