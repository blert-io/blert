export type Point = {
  x: number;
  y: number;
};

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TimelineLayout = {
  cellSize: number;
  cellGap: number;
  tickHeight: number;
  startTick: number;
  tickCount: number;
  rowOrder: string[];
};

export type TimelineHover =
  | { type: 'cell'; tick: number; rowId: string }
  | { type: 'tick-header'; tick: number };
