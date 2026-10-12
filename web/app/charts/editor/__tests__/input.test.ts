import { BCFAction, BCFResolver, BlertChartFormat } from '@blert/bcf';

import { deriveState } from '../attack-cycle';
import { EditorState, currentDocument, initialState } from '../editor-state';
import { InputContext, Keypress, keyIntents, pressIntent } from '../input';

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
      { type: 'toggle-drawer' },
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
    expect(intents('a')).toEqual([{ type: 'toggle-drawer' }]);
    expect(intents('a', { altKey: true })).toEqual([]);
    expect(intents('/')).toEqual([{ type: 'open-search' }]);
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
      fill: { action: SCYTHE, actorId: 'p1', endTick: 4, startTick: 4 },
    });
    expect(
      pressIntent(withBrush, {
        altKey: false,
        cell: { actorId: 'verzik', tick: 4 },
      }),
    ).toBeNull();
  });

  it('focuses a cell if no brush is set', () => {
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
    ).toEqual({ type: 'set-focus', focus: { actorId: 'p1', tick: 4 } });
    expect(
      pressIntent(withoutBrush, {
        altKey: false,
        cell: { actorId: 'p1', tick: 3 },
      }),
    ).toEqual({ type: 'set-focus', focus: { actorId: 'p1', tick: 3 } });
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
