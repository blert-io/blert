import { BCFActor, BlertChartFormat } from '@blert/bcf';

import { placeAction, removeActor, setTotalTicks } from '../bcf-mutator';
import {
  EditorState,
  currentDocument,
  initialState,
  reduce,
} from '../editor-state';

const VERZIK: BCFActor = {
  id: 'verzik',
  type: 'npc',
  name: 'Verzik Vitur',
  npcId: 8370,
};

const P1: BCFActor = { id: 'p1', type: 'player', name: 'Player 1' };
const P2: BCFActor = { id: 'p2', type: 'player', name: 'Player 2' };

function withHistory(documents: BlertChartFormat[]): EditorState {
  return {
    ...initialState(documents[0]),
    history: documents,
    position: documents.length - 1,
  };
}

describe('initialState', () => {
  it('keeps an existing row order and starts unmodified', () => {
    const bcf: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 30, rowOrder: ['p1', 'verzik', 'p2'] },
      timeline: { actors: [P1, VERZIK, P2], ticks: [] },
    };
    const state = initialState(bcf);

    expect(currentDocument(state)).toBe(bcf);
    expect(state.position).toBe(0);
    expect(state.modified).toBe(false);
  });

  it('orders NPCs before players if the document has no row order', () => {
    const state = initialState({
      version: '1.0',
      config: { totalTicks: 30 },
      timeline: { actors: [P1, VERZIK, P2], ticks: [] },
    });

    expect(currentDocument(state).config.rowOrder).toEqual([
      'verzik',
      'p1',
      'p2',
    ]);
    expect(state.history).toHaveLength(1);
    expect(state.modified).toBe(false);
  });
});

describe('undo', () => {
  it('reverts to a previous state', () => {
    const current: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    };
    const previous = setTotalTicks(current, 25);
    const state = reduce(withHistory([previous, current]), { type: 'undo' });
    expect(state.position).toBe(0);
    expect(currentDocument(state)).toBe(previous);
    expect(state.modified).toBe(true);
  });

  it('does nothing at the start of history', () => {
    const state = initialState({
      version: '1.0',
      config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    });
    expect(reduce(state, { type: 'undo' })).toBe(state);
  });
});

describe('redo', () => {
  it('restores the next state', () => {
    const current: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    };
    const previous = setTotalTicks(current, 25);
    const state = reduce(
      { ...withHistory([previous, current]), position: 0 },
      { type: 'redo' },
    );
    expect(state.position).toBe(1);
    expect(currentDocument(state)).toBe(current);
  });

  it('does nothing at the end of history', () => {
    const state = initialState({
      version: '1.0',
      config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    });
    expect(reduce(state, { type: 'redo' })).toBe(state);
  });
});

describe('focus', () => {
  it('is clamped to the last tick of the document', () => {
    const current: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 40, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    };
    const previous = setTotalTicks(current, 30);
    const state = reduce(
      {
        ...withHistory([previous, current]),
        focus: { actorId: 'p1', tick: 35 },
      },
      { type: 'undo' },
    );
    expect(state.focus).toEqual({ actorId: 'p1', tick: 29 });
  });

  it('is cleared if its target no longer exists', () => {
    const current: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 30, rowOrder: ['verzik', 'p1', 'p2'] },
      timeline: { actors: [VERZIK, P1, P2], ticks: [] },
    };
    const previous = removeActor(current, 'p2');
    const state = reduce(
      {
        ...withHistory([previous, current]),
        focus: { actorId: 'p2', tick: 3 },
      },
      { type: 'undo' },
    );
    expect(state.focus).toBeNull();
  });

  it('is not modified if its cell is still valid', () => {
    const current: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 40, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    };
    const focus = { actorId: 'p1', tick: 3 };
    const state = reduce(
      { ...withHistory([setTotalTicks(current, 30), current]), focus },
      { type: 'undo' },
    );
    expect(state.focus).toBe(focus);
  });

  it('is clamped into the display window', () => {
    const state = reduce(
      initialState({
        version: '1.0',
        config: { totalTicks: 31, startTick: 1, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      { type: 'set-focus', focus: { actorId: 'p1', tick: 0 } },
    );

    expect(state.focus).toEqual({ actorId: 'p1', tick: 1 });
  });
});

describe('update', () => {
  function resize(
    state: EditorState,
    totalTicks: number,
    at: number,
    coalesce?: string,
  ): EditorState {
    return reduce(state, {
      type: 'update',
      mutate: (bcf) => setTotalTicks(bcf, totalTicks),
      coalesce,
      at,
    });
  }

  it('pushes the updated document to history and marks state as modified', () => {
    const chart: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    };

    const state = resize(initialState(chart), 40, 0);

    expect(state.history.map((h) => h.config.totalTicks)).toEqual([30, 40]);
    expect(state.position).toBe(1);
    expect(state.modified).toBe(true);
    expect(state.history[0]).toBe(chart);
  });

  it('truncates any future entries', () => {
    const chart: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    };

    const withUndo = {
      ...withHistory([chart, setTotalTicks(chart, 40)]),
      position: 0,
    };
    const state = resize(withUndo, 50, 0);

    expect(state.history.map((h) => h.config.totalTicks)).toEqual([30, 50]);
    expect(state.position).toBe(1);
  });

  it('collapses consecutive updates sharing a key into one entry', () => {
    let state = initialState({
      version: '1.0',
      config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    });
    state = resize(state, 31, 0, 'ticks');
    state = resize(state, 32, 100, 'ticks');
    state = resize(state, 33, 200, 'ticks');

    expect(state.history.map((h) => h.config.totalTicks)).toEqual([30, 33]);
    expect(state.position).toBe(1);
    expect(reduce(state, { type: 'undo' }).position).toBe(0);
  });

  it('separates updates with distinct keys', () => {
    const chart: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    };

    let state = initialState(chart);
    state = resize(state, 31, 0, 'a');
    state = resize(state, 32, 100, 'b');

    expect(state.history.map((h) => h.config.totalTicks)).toEqual([30, 31, 32]);

    state = initialState(chart);
    state = resize(state, 31, 0, 'ticks');
    state = resize(state, 32, 100);
    state = resize(state, 33, 200, 'ticks');

    expect(state.history.map((h) => h.config.totalTicks)).toEqual([
      30, 31, 32, 33,
    ]);
  });

  it('stops coalescing after an undo', () => {
    let state = initialState({
      version: '1.0',
      config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    });
    state = resize(state, 31, 0, 'ticks');
    state = resize(state, 32, 100, 'ticks');
    expect(state.coalesce).not.toBeNull();

    state = reduce(state, { type: 'undo' });
    expect(state.coalesce).toBeNull();

    state = resize(state, 40, 200, 'ticks');
    expect(state.history.map((h) => h.config.totalTicks)).toEqual([30, 40]);
  });
});

describe('set-focus', () => {
  it('focuses the given cell', () => {
    const hocus = { actorId: 'p1', tick: 4 };
    const initial = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      focus: { actorId: 'verzik', tick: 9 },
      focusedBy: 'keyboard' as const,
    };

    const state = reduce(initial, { type: 'set-focus', focus: hocus });
    expect(state).toEqual({ ...initial, focus: hocus, focusedBy: 'pointer' });
  });

  it('clears focus on null', () => {
    const state = reduce(
      {
        ...initialState({
          version: '1.0',
          config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
          timeline: { actors: [VERZIK, P1], ticks: [] },
        }),
        focus: { actorId: 'verzik', tick: 7 },
      },
      { type: 'set-focus', focus: null },
    );

    expect(state.focus).toBeNull();
    expect(state.modified).toBe(false);
  });
});

describe('move-focus', () => {
  it('moves focus by rows in order', () => {
    const state = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['p1', 'verzik'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      focus: { actorId: 'p1', tick: 3 },
    };

    const down = reduce(state, { type: 'move-focus', rows: 1, ticks: 0 });
    expect(down.focus).toEqual({ actorId: 'verzik', tick: 3 });

    const up = reduce(down, { type: 'move-focus', rows: -2, ticks: 0 });
    expect(up.focus).toEqual({ actorId: 'p1', tick: 3 });
  });

  it('moves focus by ticks', () => {
    const state = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      focus: { actorId: 'p1', tick: 3 },
      focusedBy: 'pointer' as const,
    };

    let next = reduce(state, { type: 'move-focus', rows: 0, ticks: 5 });
    expect(next).toEqual({
      ...state,
      focus: { actorId: 'p1', tick: 8 },
      focusedBy: 'keyboard',
    });
    next = reduce(next, { type: 'move-focus', rows: 0, ticks: -6 });
    expect(next).toEqual({
      ...state,
      focus: { actorId: 'p1', tick: 2 },
      focusedBy: 'keyboard',
    });
  });

  it('clamps focus between first and last rows', () => {
    const state = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['p1', 'verzik', 'p2'] },
        timeline: { actors: [VERZIK, P1, P2], ticks: [] },
      }),
      focus: { actorId: 'verzik', tick: 0 },
    };

    const top = reduce(state, { type: 'move-focus', rows: -5, ticks: 0 });
    expect(top.focus).toEqual({ actorId: 'p1', tick: 0 });

    const bottom = reduce(state, { type: 'move-focus', rows: 5, ticks: 0 });
    expect(bottom.focus).toEqual({ actorId: 'p2', tick: 0 });
  });

  it('clamps focus between the first and last ticks', () => {
    const state = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      focus: { actorId: 'p1', tick: 0 },
    };

    const start = reduce(state, { type: 'move-focus', rows: 0, ticks: -50 });
    expect(start).toEqual({ ...state, focusedBy: 'keyboard' });

    const end = reduce(state, { type: 'move-focus', rows: 0, ticks: 50 });
    expect(end.focus).toEqual({ actorId: 'p1', tick: 29 });
  });

  it('focuses the first displayed cell if nothing is focused', () => {
    const state = initialState({
      version: '1.0',
      config: { totalTicks: 31, startTick: 1, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    });
    const next = reduce(state, { type: 'move-focus', rows: 1, ticks: 5 });
    expect(next.focus).toEqual({ actorId: 'verzik', tick: 1 });
  });
});

describe('place-slot-at-focus', () => {
  it('sets the focused cell and advances', () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const bgs = {
      type: 'attack' as const,
      attackType: 'BGS_SPEC',
      weaponId: 11804,
    };
    const veng = { type: 'spell' as const, spellType: 'VENGEANCE' };
    const chart: BlertChartFormat = {
      version: '1.0',
      config: { totalTicks: 24, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    };
    const initial = {
      ...initialState(chart),
      slots: [scythe, bgs, veng, null, null, null, null, null, null],
      focus: { actorId: 'p1', tick: 4 },
      focusedBy: 'keyboard' as const,
    };

    let state: EditorState = initial;
    for (const [i, slot] of [2, 0, 1, 0, 0].entries()) {
      state = reduce(state, { type: 'place-slot-at-focus', slot, at: i * 300 });
    }

    let expected = placeAction(chart, 'p1', 4, veng);
    expected = placeAction(expected, 'p1', 4, scythe);
    expected = placeAction(expected, 'p1', 9, bgs);
    expected = placeAction(expected, 'p1', 15, scythe);
    expected = placeAction(expected, 'p1', 20, scythe);
    expect(state).toEqual({
      ...initial,
      history: [chart, expected],
      position: 1,
      coalesce: { key: 'place', position: 1, at: 1200 },
      modified: true,
      focus: { actorId: 'p1', tick: 23 },
    });
    expect(currentDocument(reduce(state, { type: 'undo' }))).toBe(chart);
  });

  it('does nothing if the selected slot is incompatible with the focused cell', () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const verzikFocus = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      slots: [scythe, null, null, null, null, null, null, null, null],
      focus: { actorId: 'verzik', tick: 4 },
      focusedBy: 'keyboard' as const,
    };
    const p1Focus = { ...verzikFocus, focus: { actorId: 'p1', tick: 4 } };
    const noFocus = { ...verzikFocus, focus: null };

    expect(
      reduce(verzikFocus, { type: 'place-slot-at-focus', slot: 0, at: 0 }),
    ).toBe(verzikFocus);
    expect(
      reduce(p1Focus, { type: 'place-slot-at-focus', slot: 1, at: 0 }),
    ).toBe(p1Focus);
    expect(
      reduce(noFocus, { type: 'place-slot-at-focus', slot: 0, at: 0 }),
    ).toBe(noFocus);
  });
});

describe('set-brush', () => {
  it('sets the brush to the given action and deselects an active slot', () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const bgs = {
      type: 'attack' as const,
      attackType: 'BGS_SPEC',
      weaponId: 11804,
    };
    const selected = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      slots: [null, null, scythe, null, null, null, null, null, null],
      activeSlot: 2,
      brush: scythe,
    };

    const state = reduce(selected, { type: 'set-brush', brush: bgs });
    expect(state).toEqual({ ...selected, brush: bgs, activeSlot: null });
  });

  it('clears the existing brush on null', () => {
    const withBrush = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      brush: { type: 'attack' as const, attackType: 'SCYTHE' },
    };

    let state = reduce(withBrush, { type: 'set-brush', brush: null });
    expect(state.brush).toBeNull();
    state = reduce(state, { type: 'set-brush', brush: null });
    expect(state.brush).toBeNull();
  });
});

describe('add-to-hotbar', () => {
  it('binds the action to the active slot', () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const bgs = {
      type: 'attack' as const,
      attackType: 'BGS_SPEC',
      weaponId: 11804,
    };
    const selected = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      slots: [null, null, scythe, null, null, null, null, null, null],
      activeSlot: 2,
      brush: scythe,
    };

    const state = reduce(selected, { type: 'add-to-hotbar', action: bgs });
    expect(state).toEqual({
      ...selected,
      slots: [null, null, bgs, null, null, null, null, null, null],
      brush: bgs,
    });
  });

  it('binds the action to the first empty slot if no slot is active', () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const bgs = {
      type: 'attack' as const,
      attackType: 'BGS_SPEC',
      weaponId: 11804,
    };
    const initial = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      slots: [scythe, null, null, null, null, null, null, null, null],
      brush: scythe,
    };

    const state = reduce(initial, { type: 'add-to-hotbar', action: bgs });
    expect(state).toEqual({
      ...initial,
      slots: [scythe, bgs, null, null, null, null, null, null, null],
    });
  });

  it('does nothing if every slot is bound and none is active', () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const bgs = {
      type: 'attack' as const,
      attackType: 'BGS_SPEC',
      weaponId: 11804,
    };
    const full = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      slots: new Array(9).fill(scythe),
    };

    const state = reduce(full, { type: 'add-to-hotbar', action: bgs });
    expect(state).toBe(full);
  });
});

describe('select-slot', () => {
  it("sets the brush to the slot's action", () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const initial = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      slots: [null, null, scythe, null, null, null, null, null, null],
    };

    const state = reduce(initial, { type: 'select-slot', slot: 2 });
    expect(state).toEqual({ ...initial, activeSlot: 2, brush: scythe });
  });

  it('clears the brush if the slot is empty', () => {
    const initial = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      brush: { type: 'attack' as const, attackType: 'SCYTHE' },
    };

    const state = reduce(initial, { type: 'select-slot', slot: 4 });
    expect(state).toEqual({ ...initial, activeSlot: 4, brush: null });
  });
});

describe('set-slot', () => {
  it('binds the action to the slot', () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const initial = initialState({
      version: '1.0',
      config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    });

    const state = reduce(initial, {
      type: 'set-slot',
      slot: 2,
      action: scythe,
    });
    expect(state).toEqual({
      ...initial,
      slots: [null, null, scythe, null, null, null, null, null, null],
    });
  });

  it('updates the brush if the slot is active', () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const bgs = {
      type: 'attack' as const,
      attackType: 'BGS_SPEC',
      weaponId: 11804,
    };
    const selected = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      slots: [null, null, scythe, null, null, null, null, null, null],
      activeSlot: 2,
      brush: scythe,
    };

    const state = reduce(selected, { type: 'set-slot', slot: 2, action: bgs });
    expect(state).toEqual({
      ...selected,
      slots: [null, null, bgs, null, null, null, null, null, null],
      brush: bgs,
    });
  });
});

describe('set-slots', () => {
  it('replaces every slot', () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const bgs = {
      type: 'attack' as const,
      attackType: 'BGS_SPEC',
      weaponId: 11804,
    };
    const initial = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      slots: [null, null, scythe, null, null, null, null, null, null],
    };
    const slots = [bgs, null, null, null, scythe, null, null, null, null];

    const state = reduce(initial, { type: 'set-slots', slots });
    expect(state).toEqual({ ...initial, slots });
    expect(state.slots).toBe(slots);
  });

  it('updates the brush if a slot is active', () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const bgs = {
      type: 'attack' as const,
      attackType: 'BGS_SPEC',
      weaponId: 11804,
    };
    const selected = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      slots: [null, null, scythe, null, null, null, null, null, null],
      activeSlot: 2,
      brush: scythe,
    };
    const slots = [null, null, bgs, null, null, null, null, null, null];

    const state = reduce(selected, { type: 'set-slots', slots });
    expect(state).toEqual({ ...selected, slots, brush: bgs });
  });

  it('fits slots to the hotbar size', () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const bgs = {
      type: 'attack' as const,
      attackType: 'BGS_SPEC',
      weaponId: 11804,
    };
    const initial = initialState({
      version: '1.0',
      config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
      timeline: { actors: [VERZIK, P1], ticks: [] },
    });

    let state = reduce(initial, { type: 'set-slots', slots: [scythe] });
    expect(state).toEqual({
      ...initial,
      slots: [scythe, null, null, null, null, null, null, null, null],
    });

    state = reduce(initial, {
      type: 'set-slots',
      slots: [null, null, null, null, null, null, null, null, scythe, bgs],
    });
    expect(state).toEqual({
      ...initial,
      slots: [null, null, null, null, null, null, null, null, scythe],
    });
  });
});

describe('swap-slots', () => {
  it('swaps actions between the two slots', () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const bgs = {
      type: 'attack' as const,
      attackType: 'BGS_SPEC',
      weaponId: 11804,
    };
    const initial = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      slots: [null, null, scythe, null, null, bgs, null, null, null],
    };

    const state = reduce(initial, { type: 'swap-slots', from: 2, to: 5 });
    expect(state).toEqual({
      ...initial,
      slots: [null, null, bgs, null, null, scythe, null, null, null],
    });
  });

  it('moves an active source slot with its action', () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const selected = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      slots: [null, null, scythe, null, null, null, null, null, null],
      activeSlot: 2,
      brush: scythe,
    };

    const state = reduce(selected, { type: 'swap-slots', from: 2, to: 7 });
    expect(state).toEqual({
      ...selected,
      slots: [null, null, null, null, null, null, null, scythe, null],
      activeSlot: 7,
    });
  });

  it('moves an active target slot with its action', () => {
    const scythe = {
      type: 'attack' as const,
      attackType: 'SCYTHE',
      weaponId: 22325,
    };
    const bgs = {
      type: 'attack' as const,
      attackType: 'BGS_SPEC',
      weaponId: 11804,
    };
    const selected = {
      ...initialState({
        version: '1.0',
        config: { totalTicks: 30, rowOrder: ['verzik', 'p1'] },
        timeline: { actors: [VERZIK, P1], ticks: [] },
      }),
      slots: [null, null, scythe, null, null, bgs, null, null, null],
      activeSlot: 2,
      brush: scythe,
    };

    const state = reduce(selected, { type: 'swap-slots', from: 5, to: 2 });
    expect(state).toEqual({
      ...selected,
      slots: [null, null, bgs, null, null, scythe, null, null, null],
      activeSlot: 5,
    });
  });
});
