import { hitTest } from '../hit-test';
import { TimelineLayout } from '../types';

const ROW_ORDER = ['npc_1', 'player_a', 'player_b'];

function makeLayout(overrides?: Partial<TimelineLayout>): TimelineLayout {
  return {
    cellSize: 30,
    cellGap: 5,
    tickHeight: 30,
    startTick: 1,
    tickCount: 10,
    rowOrder: ROW_ORDER,
    ...overrides,
  };
}

describe('hitTest', () => {
  const layout = makeLayout();
  // Column width = cellSize + cellGap = 35
  // Grid top = tickHeight = 30
  // Row height = cellSize + cellGap = 35

  describe('cell hits', () => {
    it('returns the first cell at the top-left corner of the grid', () => {
      const result = hitTest(0, 30, layout);
      expect(result).toEqual({
        type: 'cell',
        tick: 1,
        rowId: 'npc_1',
        rowIndex: 0,
        cellX: 0,
        cellY: 30,
      });
    });

    it('returns the correct cell in the middle of the grid', () => {
      const result = hitTest(75, 70, layout);
      expect(result).toEqual({
        type: 'cell',
        tick: 3,
        rowId: 'player_a',
        rowIndex: 1,
        cellX: 70,
        cellY: 65,
      });
    });

    it('hits the last cell in the grid', () => {
      const result = hitTest(320, 105, layout);
      expect(result).toEqual({
        type: 'cell',
        tick: 10,
        rowId: 'player_b',
        rowIndex: 2,
        cellX: 315,
        cellY: 100,
      });
    });

    it('returns the correct cell at the bottom-right corner of a cell', () => {
      const result = hitTest(29, 59, layout);
      expect(result).toEqual({
        type: 'cell',
        tick: 1,
        rowId: 'npc_1',
        rowIndex: 0,
        cellX: 0,
        cellY: 30,
      });
    });
  });

  describe('tick header hits', () => {
    it('returns tick-header for click in the header area', () => {
      const result = hitTest(10, 5, layout);
      expect(result).toEqual({ type: 'tick-header', tick: 1 });
    });

    it('returns the correct tick for a later column header', () => {
      const result = hitTest(145, 15, layout);
      expect(result).toEqual({ type: 'tick-header', tick: 5 });
    });
  });

  describe('gap rejection', () => {
    it('returns null for horizontal gap between columns', () => {
      const result = hitTest(31, 35, layout);
      expect(result).toBeNull();
    });

    it('returns null for vertical gap between rows', () => {
      const result = hitTest(10, 61, layout);
      expect(result).toBeNull();
    });

    it('returns null for gap in tick header area', () => {
      const result = hitTest(31, 5, layout);
      expect(result).toBeNull();
    });
  });

  describe('out of bounds', () => {
    it('returns null for x beyond the last column', () => {
      const result = hitTest(350, 35, layout);
      expect(result).toBeNull();
    });

    it('returns null for y below the last row', () => {
      const result = hitTest(10, 135, layout);
      expect(result).toBeNull();
    });

    it('returns null for negative coordinates', () => {
      expect(hitTest(-1, 35, layout)).toBeNull();
      expect(hitTest(10, -1, layout)).toBeNull();
    });
  });

  describe('startTick offset', () => {
    it('maps column 0 to startTick', () => {
      const offset = makeLayout({ startTick: 50 });
      const result = hitTest(0, 30, offset);
      expect(result).toEqual(
        expect.objectContaining({ type: 'cell', tick: 50 }),
      );
    });

    it('maps later columns correctly with startTick offset', () => {
      const offset = makeLayout({ startTick: 50 });
      const result = hitTest(75, 30, offset);
      expect(result).toEqual(
        expect.objectContaining({ type: 'cell', tick: 52 }),
      );
    });
  });

  describe('different cell sizes', () => {
    it('works with a smaller cell size', () => {
      const small = makeLayout({ cellSize: 24, cellGap: 5 });
      const result = hitTest(30, 31, small);
      expect(result).toEqual({
        type: 'cell',
        tick: 2,
        rowId: 'npc_1',
        rowIndex: 0,
        cellX: 29,
        cellY: 30,
      });
    });
  });
});
