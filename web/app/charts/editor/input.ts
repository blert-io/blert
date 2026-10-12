import { BCFAction, BCFResolver, actorTypeSupportsAction } from '@blert/bcf';

import { cycleAttack } from './action-registry';
import { findOffCooldownTick } from './attack-cycle';
import {
  CellCoord,
  EditorAction,
  EditorState,
  currentDocument,
  displayWindow,
} from './editor-state';

export type Keypress = {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
  /**
   * Type of element the key was pressed in.
   * A text field owns every key; any other control owns Enter, Space and Tab.
   */
  target: 'body' | 'control' | 'text';
};

/** A primary button press on a cell. */
export type Press = { altKey: boolean; cell: CellCoord };

/** An in-progress fill spanning from `startTick` to `endTick`. */
export type Fill = {
  action: BCFAction;
  actorId: string;
  endTick: number;
  startTick: number;
};

export type InputContext = {
  at: number;
  /** Resolves the document with its derived cell state. */
  derivedResolver: BCFResolver;
  resolver: BCFResolver;
  state: EditorState;
};

export type PressContext = { brush: BCFAction | null; resolver: BCFResolver };

type EditorIntent = Extract<
  EditorAction,
  {
    type:
      | 'move-focus'
      | 'place-slot-at-focus'
      | 'redo'
      | 'select-slot'
      | 'set-brush'
      | 'set-focus'
      | 'undo';
  }
>;

export type KeyIntent =
  | EditorIntent
  | { type: 'open-search' }
  | { type: 'reject-slot'; focus: CellCoord; invalid: boolean; slot: number }
  | { type: 'remove-cell'; cell: CellCoord }
  | { type: 'rename-row'; actorId: string }
  | { type: 'toggle-drawer'; panel: 'actions' | 'rows' }
  | { type: 'zoom'; delta: number };

export type PressIntent =
  | Extract<EditorAction, { type: 'set-brush' | 'set-focus' }>
  | { type: 'start-fill'; fill: Fill };

export function canPlace(
  resolver: BCFResolver,
  actorId: string,
  action: BCFAction,
): boolean {
  const actor = resolver.getActor(actorId);
  return (
    actor !== undefined && actorTypeSupportsAction(actor.type, action.type)
  );
}

/** Returns the actions `keypress` applies given some state, in order. */
export function keyIntents(
  context: InputContext,
  keypress: Keypress,
): KeyIntent[] {
  const { altKey, ctrlKey, key, metaKey, shiftKey, target } = keypress;
  if (target === 'text') {
    return [];
  }
  if ((key === 'Enter' || key === ' ' || key === 'Tab') && target !== 'body') {
    return [];
  }

  const { at, derivedResolver, resolver, state } = context;
  const { activeSlot, brush, focus, focusedBy, slots } = state;
  const bcf = currentDocument(state);
  const modifier = ctrlKey || metaKey;

  const focusRowEdge = (edge: 'end' | 'start'): KeyIntent[] => {
    if (focus === null) {
      return [];
    }
    const [first, last] = displayWindow(bcf);
    const tick = edge === 'start' ? first : last;
    return [{ type: 'move-focus', rows: 0, ticks: tick - focus.tick }];
  };

  switch (key) {
    case 'z':
    case 'Z':
      return modifier ? [{ type: shiftKey ? 'redo' : 'undo' }] : [];

    case 'y':
      return modifier ? [{ type: 'redo' }] : [];

    case '-':
    case '=':
    case '+':
      return modifier ? [{ type: 'zoom', delta: key === '-' ? -2 : 2 }] : [];

    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
      if (
        metaKey &&
        !ctrlKey &&
        !altKey &&
        (key === 'ArrowLeft' || key === 'ArrowRight')
      ) {
        return focusRowEdge(key === 'ArrowLeft' ? 'start' : 'end');
      }
      if (modifier || altKey) {
        return [];
      }
      return [
        {
          type: 'move-focus',
          rows: key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0,
          ticks: key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0,
        },
      ];

    case 'Home':
    case 'End':
      if (modifier || altKey) {
        return [];
      }
      return focusRowEdge(key === 'Home' ? 'start' : 'end');

    case 'Enter':
      // Switches focus to keyboard mode on the same cell.
      if (focus === null || modifier || altKey || focusedBy !== 'pointer') {
        return [];
      }
      return [{ type: 'move-focus', rows: 0, ticks: 0 }];

    case 'Tab': {
      if (focus === null || modifier || altKey) {
        return [];
      }
      const target = findOffCooldownTick(
        derivedResolver,
        focus.actorId,
        focus.tick,
        shiftKey ? 'backward' : 'forward',
      );
      const [first, last] = displayWindow(bcf);
      const visible = target !== null && target >= first && target <= last;
      return [
        {
          type: 'move-focus',
          rows: 0,
          ticks: visible ? target - focus.tick : 0,
        },
      ];
    }

    case 'F2':
      if (focus === null || modifier || altKey) {
        return [];
      }
      return [{ type: 'rename-row', actorId: focus.actorId }];

    case 'Delete':
      if (
        focus === null ||
        resolver.getCell(focus.actorId, focus.tick) === undefined
      ) {
        return [];
      }
      return [{ type: 'remove-cell', cell: focus }];

    case 'Backspace': {
      if (focus === null) {
        return [];
      }
      const back: KeyIntent = { type: 'move-focus', rows: 0, ticks: -1 };
      if (resolver.getCell(focus.actorId, focus.tick) === undefined) {
        return [back];
      }
      return [{ type: 'remove-cell', cell: focus }, back];
    }

    case 'a':
    case 'A':
      if (modifier || altKey) {
        return [];
      }
      return [{ type: 'toggle-drawer', panel: 'actions' }];

    case 'r':
    case 'R':
      if (modifier || altKey) {
        return [];
      }
      return [{ type: 'toggle-drawer', panel: 'rows' }];

    case 's':
    case 'S': {
      if (modifier || brush === null) {
        return [];
      }
      const next = cycleAttack(brush, shiftKey ? -1 : 1);
      return next === null ? [] : [{ type: 'set-brush', brush: next }];
    }

    case '/':
      return modifier ? [] : [{ type: 'open-search' }];

    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
    case '7':
    case '8':
    case '9': {
      if (modifier || altKey) {
        return [];
      }
      const slot = Number(key) - 1;
      if (focus === null || focusedBy !== 'keyboard') {
        return [{ type: 'select-slot', slot }];
      }
      const action = slots[slot];
      if (action !== null && canPlace(resolver, focus.actorId, action)) {
        return [{ type: 'place-slot-at-focus', slot, at }];
      }
      return [{ type: 'reject-slot', focus, invalid: action !== null, slot }];
    }

    case 'Escape':
      if (brush !== null || activeSlot !== null) {
        return [{ type: 'set-brush', brush: null }];
      }
      return focus === null ? [] : [{ type: 'set-focus', focus: null }];
  }

  return [];
}

/** Returns the action that `press` applies given some state. */
export function pressIntent(
  context: PressContext,
  press: Press,
): PressIntent | null {
  const { brush, resolver } = context;
  const { altKey, cell } = press;

  if (altKey) {
    const actions = resolver.getCell(cell.actorId, cell.tick)?.actions ?? [];
    const picked = actions.find((a) => a.type === 'attack') ?? actions[0];
    return picked === undefined ? null : { type: 'set-brush', brush: picked };
  }

  if (brush === null) {
    return { type: 'set-focus', focus: cell };
  }
  if (!canPlace(resolver, cell.actorId, brush)) {
    return null;
  }
  return {
    type: 'start-fill',
    fill: {
      action: brush,
      actorId: cell.actorId,
      endTick: cell.tick,
      startTick: cell.tick,
    },
  };
}
