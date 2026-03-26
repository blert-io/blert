import { TimelineLayout } from './types';

export type CellHit = {
  type: 'cell';
  tick: number;
  rowId: string;
  rowIndex: number;
  /** Cell top-left X in tile-local coordinates. */
  cellX: number;
  /** Cell top-left Y in tile-local coordinates. */
  cellY: number;
};

export type TickHeaderHit = {
  type: 'tick-header';
  tick: number;
};

export type HitTestResult = CellHit | TickHeaderHit;

/**
 * Determines what element is under the cursor in a tile canvas.
 *
 * @param cursorX Cursor X relative to the tile canvas element.
 * @param cursorY Cursor Y relative to the tile canvas element.
 * @param layout Layout parameters for the tile.
 * @returns The hit cell or tick header, or `null` if nothing is hit.
 */
export function hitTest(
  cursorX: number,
  cursorY: number,
  layout: TimelineLayout,
): HitTestResult | null {
  const { cellSize, cellGap, tickHeight, startTick, tickCount, rowOrder } =
    layout;

  const columnWidth = cellSize + cellGap;

  const colIndex = Math.floor(cursorX / columnWidth);
  if (colIndex < 0 || colIndex >= tickCount) {
    return null;
  }

  // Check if cursor is in the gap between columns.
  const xInColumn = cursorX - colIndex * columnWidth;
  if (xInColumn > cellSize) {
    return null;
  }

  const tick = startTick + colIndex;
  const headerBottom = tickHeight;

  if (cursorY >= 0 && cursorY < headerBottom) {
    return { type: 'tick-header', tick };
  }

  // Check if cursor is in the cell grid area.
  const gridTop = headerBottom;
  const yInGrid = cursorY - gridTop;
  if (yInGrid < 0) {
    return null;
  }

  const rowHeight = cellSize + cellGap;
  const rowIndex = Math.floor(yInGrid / rowHeight);
  if (rowIndex < 0 || rowIndex >= rowOrder.length) {
    return null;
  }

  // Check if cursor is in the gap between rows.
  const yInRow = yInGrid - rowIndex * rowHeight;
  if (yInRow > cellSize) {
    return null;
  }

  const cellX = colIndex * columnWidth;
  const cellY = gridTop + rowIndex * rowHeight;

  return {
    type: 'cell',
    tick,
    rowId: rowOrder[rowIndex],
    rowIndex,
    cellX,
    cellY,
  };
}
