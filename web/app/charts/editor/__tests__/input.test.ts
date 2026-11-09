import { BCFAction, BCFResolver, BlertChartFormat } from '@blert/bcf';

import { deriveState } from '../attack-cycle';
import { EditorState, currentDocument, initialState } from '../editor-state';
import {
  Fill,
  InputContext,
  Keypress,
  Marquee,
  applyFill,
  autoScrollSpeed,
  cellsClearedBy,
  extendDrag,
  keyIntents,
  pressIntent,
} from '../input';

const SCYTHE: BCFAction = {
  type: 'attack',
  attackType: 'SCYTHE',
  weaponId: 22325,
};

const BGS_SPEC: BCFAction = {
  type: 'attack',
  attackType: 'BGS_SPEC',
  weaponId: 11804,
};

const CLAW_SCRATCH: BCFAction = {
  type: 'attack',
  attackType: 'CLAW_SCRATCH',
  weaponId: 13652,
};

const VENGEANCE: BCFAction = { type: 'spell', spellType: 'VENGEANCE' };

const VERZIK_AUTO: BCFAction = {
  type: 'npcAttack',
  attackType: 'TOB_VERZIK_P1_AUTO',
};

function contextFor(state: EditorState, at: number): InputContext {
  const bcf = currentDocument(state);
  const derived = structuredClone(bcf);
  deriveState(derived);
  return {
    at,
    derivedResolver: new BCFResolver(derived),
    resolver: new BCFResolver(bcf),
    state,
  };
}

function keypress(
  key: string,
  modifiers: Partial<Omit<Keypress, 'key'>> = {},
): Keypress {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: 'body',
    ...modifiers,
    key,
  };
}

describe('applyFill', () => {
  it('fills every row in its range with an attack, clearing existing attacks', () => {
    const bcf: BlertChartFormat = {
      version: '1.0',
      config: {
        totalTicks: 31,
        startTick: 1,
        rowOrder: ['verzik', 'p1', 'p2'],
      },
      timeline: {
        actors: [
          { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik Vitur' },
          { type: 'player', id: 'p1', name: 'Player 1' },
          { type: 'player', id: 'p2', name: 'Player 2' },
        ],
        ticks: [
          {
            tick: 4,
            cells: [{ actorId: 'p1', actions: [VENGEANCE, BGS_SPEC] }],
          },
          { tick: 5, cells: [{ actorId: 'verzik', actions: [VERZIK_AUTO] }] },
          { tick: 7, cells: [{ actorId: 'p2', actions: [CLAW_SCRATCH] }] },
          { tick: 14, cells: [{ actorId: 'p2', actions: [BGS_SPEC] }] },
        ],
      },
    };
    const scythes: Fill = {
      type: 'fill',
      action: SCYTHE,
      dragging: true,
      origin: { x: 0, y: 0 },
      range: {
        start: { actorId: 'p1', tick: 2 },
        end: { actorId: 'p2', tick: 12 },
      },
    };

    expect(applyFill(bcf, scythes, true)).toEqual({
      ...bcf,
      timeline: {
        ...bcf.timeline,
        ticks: [
          {
            tick: 2,
            cells: [
              { actorId: 'p1', actions: [SCYTHE] },
              { actorId: 'p2', actions: [SCYTHE] },
            ],
          },
          { tick: 4, cells: [{ actorId: 'p1', actions: [VENGEANCE] }] },
          { tick: 5, cells: [{ actorId: 'verzik', actions: [VERZIK_AUTO] }] },
          {
            tick: 7,
            cells: [
              { actorId: 'p1', actions: [SCYTHE] },
              { actorId: 'p2', actions: [SCYTHE] },
            ],
          },
          {
            tick: 12,
            cells: [
              { actorId: 'p1', actions: [SCYTHE] },
              { actorId: 'p2', actions: [SCYTHE] },
            ],
          },
          { tick: 14, cells: [{ actorId: 'p2', actions: [BGS_SPEC] }] },
        ],
      },
    });
    expect(cellsClearedBy(bcf, scythes, true)).toEqual([
      { actorId: 'p1', tick: 4 },
    ]);
    expect(cellsClearedBy(bcf, scythes, false)).toEqual([]);
  });

  it('fills other actions without clearing existing ones', () => {
    const bcf: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 31, startTick: 1, rowOrder: ['verzik', 'p1'] },
      timeline: {
        actors: [
          { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik Vitur' },
          { type: 'player', id: 'p1', name: 'Player 1' },
        ],
        ticks: [
          {
            tick: 4,
            cells: [{ actorId: 'p1', actions: [VENGEANCE, BGS_SPEC] }],
          },
          { tick: 5, cells: [{ actorId: 'verzik', actions: [VERZIK_AUTO] }] },
        ],
      },
    };
    const vengeances: Fill = {
      type: 'fill',
      action: VENGEANCE,
      dragging: true,
      origin: { x: 0, y: 0 },
      range: {
        start: { actorId: 'p1', tick: 4 },
        end: { actorId: 'p1', tick: 5 },
      },
    };

    expect(applyFill(bcf, vengeances, true)).toEqual({
      ...bcf,
      timeline: {
        ...bcf.timeline,
        ticks: [
          {
            tick: 4,
            cells: [{ actorId: 'p1', actions: [BGS_SPEC, VENGEANCE] }],
          },
          {
            tick: 5,
            cells: [
              { actorId: 'verzik', actions: [VERZIK_AUTO] },
              { actorId: 'p1', actions: [VENGEANCE] },
            ],
          },
        ],
      },
    });
    expect(cellsClearedBy(bcf, vengeances, true)).toEqual([]);
  });
});

describe('autoScrollSpeed', () => {
  it('is faster nearer each edge and 0 between them', () => {
    const top = 100;
    const bottom = 700;
    expect(autoScrollSpeed(top, bottom, 400)).toBe(0);

    const nearBottom = autoScrollSpeed(top, bottom, 690);
    const atBottom = autoScrollSpeed(top, bottom, 700);
    expect(nearBottom).toBeGreaterThan(0);
    expect(atBottom).toBeGreaterThan(nearBottom);
    expect(autoScrollSpeed(top, bottom, 900)).toBe(atBottom);

    const nearTop = autoScrollSpeed(top, bottom, 110);
    const atTop = autoScrollSpeed(top, bottom, 100);
    expect(nearTop).toBeLessThan(0);
    expect(atTop).toBeLessThan(nearTop);
    expect(autoScrollSpeed(top, bottom, -100)).toBe(atTop);
    expect(atTop).toBe(-atBottom);
  });
});

describe('extendDrag', () => {
  it('moves the end of a drag to the target of a hit', () => {
    const bcf: BlertChartFormat = {
      version: '1.0',
      config: {
        totalTicks: 31,
        startTick: 1,
        rowOrder: ['verzik', 'p1', 'p2'],
      },
      timeline: {
        actors: [
          { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik Vitur' },
          { type: 'player', id: 'p1', name: 'Player 1' },
          { type: 'player', id: 'p2', name: 'Player 2' },
        ],
        ticks: [],
      },
    };
    const resolver = new BCFResolver(bcf);
    const start = { actorId: 'verzik', tick: 4 };
    const marquee: Marquee = {
      type: 'marquee',
      dragging: true,
      origin: { x: 0, y: 0 },
      range: { start, end: start },
    };

    const overCell = extendDrag(resolver, marquee, {
      type: 'cell',
      tick: 7,
      rowId: 'p2',
      rowIndex: 2,
      cellX: 210,
      cellY: 100,
    });
    expect(overCell).toEqual({
      ...marquee,
      range: { start, end: { actorId: 'p2', tick: 7 } },
    });

    const nearCell = extendDrag(resolver, overCell, {
      type: 'nearest-cell',
      tick: 9,
      rowId: 'p1',
      rowIndex: 1,
      cellX: 280,
      cellY: 65,
    });
    expect(nearCell).toEqual({
      ...marquee,
      range: { start, end: { actorId: 'p1', tick: 9 } },
    });

    const overHeader = extendDrag(resolver, nearCell, {
      type: 'tick-header',
      tick: 2,
    });
    expect(overHeader).toEqual({
      ...marquee,
      range: { start, end: { actorId: 'p1', tick: 2 } },
    });

    expect(extendDrag(resolver, overHeader, null)).toBe(overHeader);
    expect(
      extendDrag(resolver, overHeader, {
        type: 'nearest-cell',
        tick: 2,
        rowId: 'p1',
        rowIndex: 1,
        cellX: 35,
        cellY: 65,
      }),
    ).toBe(overHeader);

    const fillStart = { actorId: 'p1', tick: 4 };
    const fill: Fill = {
      type: 'fill',
      action: SCYTHE,
      dragging: true,
      origin: { x: 0, y: 0 },
      range: { start: fillStart, end: fillStart },
    };
    expect(
      extendDrag(resolver, fill, {
        type: 'cell',
        tick: 6,
        rowId: 'verzik',
        rowIndex: 0,
        cellX: 175,
        cellY: 30,
      }),
    ).toEqual({
      ...fill,
      range: { start: fillStart, end: { actorId: 'p1', tick: 6 } },
    });
  });
});

describe('keyIntents', () => {
  it('ignores all keys on text targets and control keys on control targets', () => {
    const bcf: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 31, startTick: 1, rowOrder: ['verzik', 'p1'] },
      timeline: {
        actors: [
          { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik Vitur' },
          { type: 'player', id: 'p1', name: 'Player 1' },
        ],
        ticks: [],
      },
    };
    const context = contextFor(
      { ...initialState(bcf), focus: { actorId: 'p1', tick: 3 } },
      0,
    );

    expect(keyIntents(context, keypress('a', { target: 'text' }))).toEqual([]);
    expect(keyIntents(context, keypress('Enter', { target: 'text' }))).toEqual(
      [],
    );
    for (const key of ['Enter', ' ', 'Tab']) {
      expect(keyIntents(context, keypress(key, { target: 'control' }))).toEqual(
        [],
      );
    }
    expect(keyIntents(context, keypress('a', { target: 'control' }))).toEqual([
      { type: 'toggle-drawer', panel: 'actions' },
    ]);
    expect(keyIntents(context, keypress('Enter'))).toEqual([
      { type: 'move-focus', rows: 0, ticks: 0 },
    ]);
  });

  it('moves focus on movement keys', () => {
    const bcf: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 31, startTick: 1, rowOrder: ['verzik', 'p1'] },
      timeline: {
        actors: [
          { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik Vitur' },
          { type: 'player', id: 'p1', name: 'Player 1' },
        ],
        ticks: [{ tick: 3, cells: [{ actorId: 'p1', actions: [SCYTHE] }] }],
      },
    };
    const withFocus = contextFor(
      {
        ...initialState(bcf),
        focus: { actorId: 'p1', tick: 3 },
        focusedBy: 'keyboard',
      },
      0,
    );
    const intents = (key: string, modifiers: Partial<Keypress> = {}) =>
      keyIntents(withFocus, keypress(key, modifiers));

    expect(intents('ArrowDown')).toEqual([
      { type: 'move-focus', rows: 1, ticks: 0 },
    ]);
    expect(intents('ArrowLeft')).toEqual([
      { type: 'move-focus', rows: 0, ticks: -1 },
    ]);
    expect(intents('ArrowUp', { shiftKey: true })).toEqual([
      { type: 'extend-selection', rows: -1, ticks: 0 },
    ]);
    expect(intents('ArrowRight', { shiftKey: true })).toEqual([
      { type: 'extend-selection', rows: 0, ticks: 1 },
    ]);
    expect(intents('ArrowLeft', { altKey: true })).toEqual([]);
    expect(intents('ArrowLeft', { ctrlKey: true })).toEqual([]);
    expect(intents('ArrowLeft', { metaKey: true })).toEqual([
      { type: 'move-focus', rows: 0, ticks: -2 },
    ]);
    expect(intents('ArrowRight', { metaKey: true })).toEqual([
      { type: 'move-focus', rows: 0, ticks: 27 },
    ]);
    expect(intents('Home')).toEqual([
      { type: 'move-focus', rows: 0, ticks: -2 },
    ]);
    expect(intents('End')).toEqual([
      { type: 'move-focus', rows: 0, ticks: 27 },
    ]);
    expect(intents('Enter')).toEqual([]);

    // Jump to off cooldown ticks.
    expect(intents('Tab')).toEqual([{ type: 'move-focus', rows: 0, ticks: 5 }]);
    expect(intents('Tab', { shiftKey: true })).toEqual([
      { type: 'move-focus', rows: 0, ticks: -1 },
    ]);
    const first = contextFor(
      {
        ...initialState(bcf),
        focus: { actorId: 'p1', tick: 1 },
        focusedBy: 'keyboard',
      },
      0,
    );
    expect(keyIntents(first, keypress('Tab', { shiftKey: true }))).toEqual([
      { type: 'move-focus', rows: 0, ticks: 0 },
    ]);

    const withoutFocus = contextFor(initialState(bcf), 0);
    expect(keyIntents(withoutFocus, keypress('ArrowDown'))).toEqual([
      { type: 'move-focus', rows: 1, ticks: 0 },
    ]);
    for (const key of ['Home', 'End', 'Enter', 'Tab']) {
      expect(keyIntents(withoutFocus, keypress(key))).toEqual([]);
    }
  });

  it('selects or places hotbar slots on number keys', () => {
    const bcf: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 31, startTick: 1, rowOrder: ['verzik', 'p1'] },
      timeline: {
        actors: [
          { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik Vitur' },
          { type: 'player', id: 'p1', name: 'Player 1' },
        ],
        ticks: [],
      },
    };
    const start = initialState(bcf);
    const slots = start.slots.with(0, SCYTHE).with(2, VERZIK_AUTO);
    const focus = { actorId: 'p1', tick: 3 };

    const keyboard = contextFor(
      { ...start, focus, focusedBy: 'keyboard', slots },
      1000,
    );
    expect(keyIntents(keyboard, keypress('1'))).toEqual([
      { type: 'place-slot-at-focus', slot: 0, at: 1000 },
    ]);
    expect(keyIntents(keyboard, keypress('2'))).toEqual([
      { type: 'reject-slot', focus, invalid: false, slot: 1 },
    ]);
    expect(keyIntents(keyboard, keypress('3'))).toEqual([
      { type: 'reject-slot', focus, invalid: true, slot: 2 },
    ]);
    expect(keyIntents(keyboard, keypress('1', { altKey: true }))).toEqual([]);
    expect(keyIntents(keyboard, keypress('1', { metaKey: true }))).toEqual([]);

    const pointer = contextFor({ ...start, focus, slots }, 1000);
    expect(keyIntents(pointer, keypress('1'))).toEqual([
      { type: 'select-slot', slot: 0 },
    ]);

    const withoutFocus = contextFor({ ...start, slots }, 1000);
    expect(keyIntents(withoutFocus, keypress('3'))).toEqual([
      { type: 'select-slot', slot: 2 },
    ]);
  });

  it('clears the focused cell on delete or backspace', () => {
    const bcf: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 31, startTick: 1, rowOrder: ['verzik', 'p1'] },
      timeline: {
        actors: [
          { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik Vitur' },
          { type: 'player', id: 'p1', name: 'Player 1' },
        ],
        ticks: [{ tick: 3, cells: [{ actorId: 'p1', actions: [SCYTHE] }] }],
      },
    };
    const start = initialState(bcf);

    const filled = contextFor(
      { ...start, focus: { actorId: 'p1', tick: 3 } },
      0,
    );
    expect(keyIntents(filled, keypress('Delete'))).toEqual([
      { type: 'remove-cell', cell: { actorId: 'p1', tick: 3 } },
    ]);
    expect(keyIntents(filled, keypress('Backspace'))).toEqual([
      { type: 'remove-cell', cell: { actorId: 'p1', tick: 3 } },
      { type: 'move-focus', rows: 0, ticks: -1 },
    ]);

    const empty = contextFor(
      { ...start, focus: { actorId: 'p1', tick: 4 } },
      0,
    );
    expect(keyIntents(empty, keypress('Delete'))).toEqual([]);
    expect(keyIntents(empty, keypress('Backspace'))).toEqual([
      { type: 'move-focus', rows: 0, ticks: -1 },
    ]);

    const withoutFocus = contextFor(start, 0);
    expect(keyIntents(withoutFocus, keypress('Delete'))).toEqual([]);
    expect(keyIntents(withoutFocus, keypress('Backspace'))).toEqual([]);
  });

  it('clears brush then focus on escape', () => {
    const bcf: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 31, startTick: 1, rowOrder: ['verzik', 'p1'] },
      timeline: {
        actors: [
          { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik Vitur' },
          { type: 'player', id: 'p1', name: 'Player 1' },
        ],
        ticks: [],
      },
    };
    const start = initialState(bcf);
    const focus = { actorId: 'p1', tick: 3 };
    const escape = (state: EditorState) =>
      keyIntents(contextFor(state, 0), keypress('Escape'));

    expect(escape({ ...start, brush: SCYTHE, focus })).toEqual([
      { type: 'set-brush', brush: null },
    ]);
    expect(escape({ ...start, activeSlot: 4, focus })).toEqual([
      { type: 'set-brush', brush: null },
    ]);
    expect(escape({ ...start, focus })).toEqual([
      { type: 'set-focus', focus: null },
    ]);
    expect(escape(start)).toEqual([]);
  });

  it('handles miscellaneous shortcuts', () => {
    const bcf: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 31, startTick: 1, rowOrder: ['verzik', 'p1'] },
      timeline: {
        actors: [
          { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik Vitur' },
          { type: 'player', id: 'p1', name: 'Player 1' },
        ],
        ticks: [],
      },
    };
    const start = initialState(bcf);
    const withFocus = contextFor(
      { ...start, focus: { actorId: 'p1', tick: 3 } },
      0,
    );
    const intents = (key: string, modifiers: Partial<Keypress> = {}) =>
      keyIntents(withFocus, keypress(key, modifiers));

    expect(intents('z', { ctrlKey: true })).toEqual([{ type: 'undo' }]);
    expect(intents('Z', { metaKey: true, shiftKey: true })).toEqual([
      { type: 'redo' },
    ]);
    expect(intents('y', { ctrlKey: true })).toEqual([{ type: 'redo' }]);
    expect(intents('z')).toEqual([]);
    expect(intents('-', { metaKey: true })).toEqual([
      { type: 'zoom', delta: -2 },
    ]);
    expect(intents('=', { metaKey: true })).toEqual([
      { type: 'zoom', delta: 2 },
    ]);
    expect(intents('a')).toEqual([{ type: 'toggle-drawer', panel: 'actions' }]);
    expect(intents('r')).toEqual([{ type: 'toggle-drawer', panel: 'rows' }]);
    expect(intents('r', { altKey: true })).toEqual([]);
    expect(intents('/')).toEqual([{ type: 'open-search' }]);
    expect(intents('F2')).toEqual([{ type: 'rename-row', actorId: 'p1' }]);
    expect(keyIntents(contextFor(start, 0), keypress('F2'))).toEqual([]);
  });

  it('cycles brush on s', () => {
    const bcf: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 31, startTick: 1, rowOrder: ['verzik', 'p1'] },
      timeline: {
        actors: [
          { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik Vitur' },
          { type: 'player', id: 'p1', name: 'Player 1' },
        ],
        ticks: [],
      },
    };
    const start = initialState(bcf);
    const cycle = (brush: BCFAction | null, key: string) =>
      keyIntents(
        contextFor({ ...start, brush }, 0),
        keypress(key, { shiftKey: key === 'S' }),
      );

    const clawSpec = { type: 'attack', attackType: 'CLAW_SPEC' };
    expect(cycle(CLAW_SCRATCH, 's')).toEqual([
      { type: 'set-brush', brush: clawSpec },
    ]);
    expect(cycle(CLAW_SCRATCH, 'S')).toEqual([
      { type: 'set-brush', brush: clawSpec },
    ]);
    expect(cycle(SCYTHE, 's')).toEqual([]);
    expect(cycle(null, 's')).toEqual([]);
  });
});

describe('pressIntent', () => {
  it("places the brush's action", () => {
    const bcf: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 31, startTick: 1, rowOrder: ['verzik', 'p1'] },
      timeline: {
        actors: [
          { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik Vitur' },
          { type: 'player', id: 'p1', name: 'Player 1' },
        ],
        ticks: [],
      },
    };
    const withBrush = { brush: SCYTHE, resolver: new BCFResolver(bcf) };

    expect(
      pressIntent(withBrush, {
        altKey: false,
        cell: { actorId: 'p1', tick: 4 },
      }),
    ).toEqual({
      type: 'start-fill',
      action: SCYTHE,
      cell: { actorId: 'p1', tick: 4 },
    });
    expect(
      pressIntent(withBrush, {
        altKey: false,
        cell: { actorId: 'verzik', tick: 4 },
      }),
    ).toBeNull();
  });

  it('starts a marquee at the pressed cell if no brush is set', () => {
    const bcf: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 31, startTick: 1, rowOrder: ['verzik', 'p1'] },
      timeline: {
        actors: [
          { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik Vitur' },
          { type: 'player', id: 'p1', name: 'Player 1' },
        ],
        ticks: [{ tick: 3, cells: [{ actorId: 'p1', actions: [SCYTHE] }] }],
      },
    };
    const withoutBrush = { brush: null, resolver: new BCFResolver(bcf) };

    expect(
      pressIntent(withoutBrush, {
        altKey: false,
        cell: { actorId: 'p1', tick: 4 },
      }),
    ).toEqual({ type: 'start-marquee', cell: { actorId: 'p1', tick: 4 } });
    expect(
      pressIntent(withoutBrush, {
        altKey: false,
        cell: { actorId: 'p1', tick: 3 },
      }),
    ).toEqual({ type: 'start-marquee', cell: { actorId: 'p1', tick: 3 } });
  });

  it("picks a cell's action with alt held, preferring an attack", () => {
    const bcf: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 31, startTick: 1, rowOrder: ['verzik', 'p1'] },
      timeline: {
        actors: [
          { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik Vitur' },
          { type: 'player', id: 'p1', name: 'Player 1' },
        ],
        ticks: [
          {
            tick: 9,
            cells: [{ actorId: 'p1', actions: [VENGEANCE, BGS_SPEC] }],
          },
          { tick: 15, cells: [{ actorId: 'p1', actions: [VENGEANCE] }] },
        ],
      },
    };
    const withBrush = { brush: SCYTHE, resolver: new BCFResolver(bcf) };

    expect(
      pressIntent(withBrush, {
        altKey: true,
        cell: { actorId: 'p1', tick: 9 },
      }),
    ).toEqual({ type: 'set-brush', brush: BGS_SPEC });
    expect(
      pressIntent(withBrush, {
        altKey: true,
        cell: { actorId: 'p1', tick: 15 },
      }),
    ).toEqual({ type: 'set-brush', brush: VENGEANCE });
    expect(
      pressIntent(withBrush, {
        altKey: true,
        cell: { actorId: 'p1', tick: 4 },
      }),
    ).toBeNull();
  });
});
