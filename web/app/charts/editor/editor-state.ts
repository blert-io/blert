import {
  BCFAction,
  BCFActor,
  BCFPlayerActor,
  BlertChartFormat,
  actorTypeSupportsAction,
} from '@blert/bcf';

import { clamp } from '@/utils/math';

import { attackCooldown } from './attack-cycle';
import {
  CellBlock,
  CellRegion,
  copyCells,
  pasteCells,
  placeAction,
  setRowOrder,
  translateCells,
  validateTranslation,
} from './bcf-mutator';
import { FIRST_TICK, HOTBAR_SLOTS } from './constants';

export type CellCoord = { actorId: string; tick: number };

/**
 * A rectangular block of cells selected by a user action.
 * `start` and `end` represent how the selection was made, and can be in any
 * geometric direction.
 */
export type CellRange = { start: CellCoord; end: CellCoord };

/** Actions bound to the hotbar slots. */
export type HotbarSlots = (BCFAction | null)[];

/** A value before and after an edit. */
type Change<T> = { before: T; after: T };

type HistoryEntry = {
  document: BlertChartFormat;
  // The focus and/or selection moved directly by the edit.
  focus?: Change<CellCoord | null>;
  selection?: Change<CellRange | null>;
};

export type EditorState = {
  history: HistoryEntry[];
  position: number;
  /**
   * Marks the head history entry as combinable with consecutive updates
   * sharing the same key, so they undo together.
   * Only valid while `position` matches the entry.
   */
  coalesce: { key: string; position: number; at: number } | null;

  modified: boolean;
  focus: CellCoord | null;
  /** How the focus last moved. */
  focusedBy: 'keyboard' | 'pointer';
  selection: CellRange | null;
  /** The cells last copied or cut. */
  clipboard: CellBlock | null;
  brush: BCFAction | null;
  slots: HotbarSlots;
  activeSlot: number | null;
  respectCooldowns: boolean;
};

export type EditorAction =
  | {
      type: 'update';
      mutate: (bcf: BlertChartFormat) => BlertChartFormat;
      /**
       * When set, consecutive updates with the same key collapse into one
       * history entry. Any other modification, or a period without updates,
       * ends the run.
       */
      coalesce?: string;
      /** Where to move focus after the update. */
      focus?: CellCoord | null;
      /** Where to move selection after the update. */
      selection?: CellRange | null;
      at: number;
    }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'set-focus'; focus: CellCoord | null }
  | { type: 'move-focus'; rows: number; ticks: number }
  | { type: 'set-selection'; selection: CellRange | null }
  | { type: 'extend-selection'; rows: number; ticks: number }
  | { type: 'copy'; range: CellRange }
  | { type: 'paste'; anchor: CellCoord; at: number }
  | {
      type: 'move-cells';
      range: CellRange;
      rows: number;
      ticks: number;
      focusedBy: EditorState['focusedBy'];
      coalesce?: string;
      at: number;
    }
  | { type: 'place-slot-at-focus'; slot: number; at: number }
  | { type: 'set-brush'; brush: BCFAction | null }
  | { type: 'set-respect-cooldowns'; respectCooldowns: boolean }
  | { type: 'add-to-hotbar'; action: BCFAction }
  | { type: 'select-slot'; slot: number }
  | { type: 'set-slot'; slot: number; action: BCFAction | null }
  | { type: 'set-slots'; slots: HotbarSlots }
  | { type: 'swap-slots'; from: number; to: number };

// Maximum temporal gap between coalescing edits to combine them.

const COALESCE_WINDOW_MS = 2500;

export function currentDocument(state: EditorState): BlertChartFormat {
  return state.history[state.position].document;
}

/** Returns the first and last ticks the editor displays, inclusive. */
export function displayWindow(bcf: BlertChartFormat): [number, number] {
  return [FIRST_TICK, bcf.config.totalTicks - 1];
}

/**
 * Converts a selection range to a region in a BCF document.
 * Returns an empty region if the range extends beyond the bounds of `bcf`.
 */
export function rangeToRegion(
  bcf: BlertChartFormat,
  range: CellRange,
): CellRegion {
  const { end, start } = range;
  const rowOrder = bcf.config.rowOrder ?? [];
  const startRow = rowOrder.indexOf(start.actorId);
  const endRow = rowOrder.indexOf(end.actorId);
  const startTick = Math.min(start.tick, end.tick);
  const endTick = Math.max(start.tick, end.tick);

  if (startRow === -1 || endRow === -1) {
    return { actorIds: [], startTick, endTick };
  }
  return {
    actorIds: rowOrder.slice(
      Math.min(startRow, endRow),
      Math.max(startRow, endRow) + 1,
    ),
    startTick,
    endTick,
  };
}

/** Returns a new player to add to `bcf`, with a unique actor ID. */
export function newPlayer(bcf: BlertChartFormat): BCFPlayerActor {
  const n = unusedIdNumber(bcf, 'p');
  return { type: 'player', id: `p${n}`, name: `Player ${n}` };
}

/** Returns a copy of `actor` to add to `bcf`, with a unique actor ID. */
export function actorCopy(bcf: BlertChartFormat, actor: BCFActor): BCFActor {
  const prefix = actor.type === 'player' ? 'p' : 'npc';
  const id = `${prefix}${unusedIdNumber(bcf, prefix)}`;
  return { ...actor, id, name: `${actor.name} (copy)` };
}

export function initialState(bcf: BlertChartFormat): EditorState {
  const document =
    bcf.config.rowOrder === undefined
      ? setRowOrder(bcf, defaultRowOrder(bcf.timeline.actors))
      : bcf;

  return {
    history: [{ document }],
    position: 0,
    coalesce: null,
    modified: false,
    focus: null,
    focusedBy: 'pointer',
    selection: null,
    clipboard: null,
    brush: null,
    slots: new Array<BCFAction | null>(HOTBAR_SLOTS).fill(null),
    activeSlot: null,
    respectCooldowns: true,
  };
}

export function reduce(state: EditorState, action: EditorAction): EditorState {
  return normalize(apply(state, action));
}

/** Clamps focus and selection to within the current document. */
function normalize(state: EditorState): EditorState {
  const bcf = currentDocument(state);
  const focus = normalizeFocus(bcf, state.focus);
  const selection = normalizeSelection(bcf, state.selection);
  if (focus === state.focus && selection === state.selection) {
    return state;
  }
  return { ...state, focus, selection };
}

function normalizeFocus(
  bcf: BlertChartFormat,
  focus: CellCoord | null,
): CellCoord | null {
  if (
    focus === null ||
    !bcf.timeline.actors.some((a) => a.id === focus.actorId)
  ) {
    return null;
  }
  return clampToWindow(bcf, focus);
}

/** Drops a selection with an end outside the row order. */
function normalizeSelection(
  bcf: BlertChartFormat,
  selection: CellRange | null,
): CellRange | null {
  if (selection === null) {
    return null;
  }

  const rowOrder = bcf.config.rowOrder ?? [];
  if (
    !rowOrder.includes(selection.start.actorId) ||
    !rowOrder.includes(selection.end.actorId)
  ) {
    return null;
  }

  const start = clampToWindow(bcf, selection.start);
  const end = clampToWindow(bcf, selection.end);
  return start === selection.start && end === selection.end
    ? selection
    : { start, end };
}

function clampToWindow(bcf: BlertChartFormat, cell: CellCoord): CellCoord {
  const [first, last] = displayWindow(bcf);
  const tick = clamp(cell.tick, first, last);
  return tick === cell.tick ? cell : { actorId: cell.actorId, tick };
}

/**
 * Returns `cell` moved by `delta`, clamped to the bounds of `bcf`.
 */
function offsetCell(
  bcf: BlertChartFormat,
  cell: CellCoord,
  delta: { rows: number; ticks: number },
): CellCoord {
  const rowOrder = bcf.config.rowOrder ?? [];
  const row = rowOrder.indexOf(cell.actorId);
  if (row === -1) {
    return cell;
  }

  const [first, last] = displayWindow(bcf);
  const nextRow = clamp(row + delta.rows, 0, rowOrder.length - 1);
  const tick = clamp(cell.tick + delta.ticks, first, last);
  return nextRow === row && tick === cell.tick
    ? cell
    : { actorId: rowOrder[nextRow], tick };
}

/**
 * Sets the focus and selection changed by the edit that created `entry` to
 * their values on one side of the edit, provided they still have their values
 * from the other side.
 */
function restoreFocusAndSelection(
  state: EditorState,
  entry: HistoryEntry,
  restoreTo: 'after' | 'before',
): EditorState {
  const currentSide = restoreTo === 'after' ? 'before' : 'after';
  const { focus: focusChange, selection: selectionChange } = entry;
  if (
    (focusChange !== undefined &&
      !cellCoordsEqual(state.focus, focusChange[currentSide])) ||
    (selectionChange !== undefined &&
      !cellRangesEqual(state.selection, selectionChange[currentSide]))
  ) {
    return state;
  }
  return {
    ...state,
    focus: focusChange === undefined ? state.focus : focusChange[restoreTo],
    selection:
      selectionChange === undefined
        ? state.selection
        : selectionChange[restoreTo],
  };
}

function cellCoordsEqual(
  first: CellCoord | null,
  second: CellCoord | null,
): boolean {
  if (first === null || second === null) {
    return first === second;
  }
  return first.actorId === second.actorId && first.tick === second.tick;
}

function cellRangesEqual(
  first: CellRange | null,
  second: CellRange | null,
): boolean {
  if (first === null || second === null) {
    return first === second;
  }
  return (
    cellCoordsEqual(first.start, second.start) &&
    cellCoordsEqual(first.end, second.end)
  );
}

function apply(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'update': {
      const updated = action.mutate(currentDocument(state));
      const key = action.coalesce ?? null;
      const coalescing =
        key !== null &&
        state.position === state.history.length - 1 &&
        state.coalesce?.key === key &&
        state.coalesce.position === state.position &&
        action.at - state.coalesce.at <= COALESCE_WINDOW_MS;

      // Coalescing replaces the current entry, keeping the focus and selection
      // from before the run's first edit.
      const replacedEntry = coalescing ? state.history[state.position] : null;
      const updatedEntry: HistoryEntry = {
        ...replacedEntry,
        document: updated,
      };
      if (action.focus !== undefined) {
        updatedEntry.focus = {
          before:
            replacedEntry?.focus === undefined
              ? state.focus
              : replacedEntry.focus.before,
          after: action.focus,
        };
      }
      if (action.selection !== undefined) {
        updatedEntry.selection = {
          before:
            replacedEntry?.selection === undefined
              ? state.selection
              : replacedEntry.selection.before,
          after: action.selection,
        };
      }

      const position = coalescing ? state.position : state.position + 1;
      return {
        ...state,
        history: [...state.history.slice(0, position), updatedEntry],
        position,
        coalesce: key === null ? null : { key, position, at: action.at },
        modified: true,
        focus: action.focus === undefined ? state.focus : action.focus,
        selection:
          action.selection === undefined ? state.selection : action.selection,
      };
    }

    case 'undo': {
      if (state.position === 0) {
        return state;
      }
      const undoneEntry = state.history[state.position];
      return restoreFocusAndSelection(
        {
          ...state,
          position: state.position - 1,
          coalesce: null,
          modified: true,
        },
        undoneEntry,
        'before',
      );
    }

    case 'redo': {
      if (state.position === state.history.length - 1) {
        return state;
      }
      const redoneEntry = state.history[state.position + 1];
      return restoreFocusAndSelection(
        {
          ...state,
          position: state.position + 1,
          coalesce: null,
          modified: true,
        },
        redoneEntry,
        'after',
      );
    }

    case 'set-focus':
      return {
        ...state,
        focus: action.focus,
        focusedBy: 'pointer',
        selection: null,
      };

    case 'move-focus': {
      const bcf = currentDocument(state);
      const rowOrder = bcf.config.rowOrder ?? [];

      if (state.focus === null) {
        if (rowOrder.length === 0) {
          return state;
        }
        const [first] = displayWindow(bcf);
        return {
          ...state,
          focus: { actorId: rowOrder[0], tick: first },
          focusedBy: 'keyboard',
          selection: null,
        };
      }

      const focus = offsetCell(bcf, state.focus, action);
      return { ...state, focus, focusedBy: 'keyboard', selection: null };
    }

    case 'set-selection':
      return { ...state, selection: action.selection };

    case 'extend-selection': {
      const { focus, selection } = state;
      const range =
        selection ?? (focus === null ? null : { start: focus, end: focus });
      if (range === null) {
        return state;
      }

      const end = offsetCell(currentDocument(state), range.end, action);
      if (end === range.end) {
        return state;
      }
      return {
        ...state,
        focusedBy: 'keyboard',
        selection: { start: range.start, end },
      };
    }

    case 'copy': {
      const bcf = currentDocument(state);
      const clipboard = copyCells(bcf, rangeToRegion(bcf, action.range));
      return { ...state, clipboard };
    }

    case 'paste': {
      const { clipboard } = state;
      if (clipboard === null) {
        return state;
      }

      const { anchor } = action;
      const end = offsetCell(currentDocument(state), anchor, {
        rows: clipboard.rows - 1,
        ticks: clipboard.ticks - 1,
      });
      const pasted = apply(state, {
        type: 'update',
        mutate: (bcf) => pasteCells(bcf, anchor, clipboard),
        selection: { start: anchor, end },
        at: action.at,
      });
      return { ...pasted, focus: anchor, focusedBy: 'keyboard' };
    }

    case 'move-cells': {
      const bcf = currentDocument(state);
      const region = rangeToRegion(bcf, action.range);
      if (!validateTranslation(bcf, region, action).valid) {
        return state;
      }

      const { focus, selection } = state;
      const destinationFocus =
        focus === null ? null : offsetCell(bcf, focus, action);
      const destinationSelection =
        selection !== null
          ? {
              start: offsetCell(bcf, selection.start, action),
              end: offsetCell(bcf, selection.end, action),
            }
          : null;
      const translate = (document: BlertChartFormat) =>
        translateCells(document, region, action);

      const translated = apply(state, {
        type: 'update',
        mutate: translate,
        coalesce: action.coalesce,
        focus: destinationFocus,
        selection: destinationSelection,
        at: action.at,
      });
      return { ...translated, focusedBy: action.focusedBy };
    }

    case 'place-slot-at-focus': {
      const { focus } = state;
      const bound = state.slots[action.slot] ?? null;
      if (focus === null || bound === null) {
        return state;
      }

      const actor = currentDocument(state).timeline.actors.find(
        (a) => a.id === focus.actorId,
      );
      if (
        actor === undefined ||
        !actorTypeSupportsAction(actor.type, bound.type)
      ) {
        return state;
      }

      const advancedFocus =
        bound.type === 'attack'
          ? offsetCell(currentDocument(state), focus, {
              rows: 0,
              ticks: attackCooldown(bound.attackType),
            })
          : undefined;
      return apply(
        { ...state, selection: null },
        {
          type: 'update',
          mutate: (bcf) => placeAction(bcf, focus.actorId, focus.tick, bound),
          coalesce: 'place',
          focus: advancedFocus,
          at: action.at,
        },
      );
    }

    case 'set-brush':
      return {
        ...state,
        brush: action.brush,
        activeSlot: null,
        selection: action.brush === null ? state.selection : null,
      };

    case 'set-respect-cooldowns':
      return { ...state, respectCooldowns: action.respectCooldowns };

    case 'add-to-hotbar': {
      const slot = state.activeSlot ?? state.slots.indexOf(null);
      if (slot === -1) {
        return state;
      }
      return apply(state, { type: 'set-slot', slot, action: action.action });
    }

    case 'select-slot': {
      const brush = state.slots[action.slot] ?? null;
      return {
        ...state,
        activeSlot: action.slot,
        brush,
        selection: brush === null ? state.selection : null,
      };
    }

    case 'set-slot': {
      const slots = state.slots.with(action.slot, action.action);
      if (state.activeSlot === action.slot) {
        return { ...state, slots, brush: action.action };
      }
      return { ...state, slots };
    }

    case 'set-slots': {
      const slots =
        action.slots.length === HOTBAR_SLOTS
          ? action.slots
          : Array.from(
              { length: HOTBAR_SLOTS },
              (_, i) => action.slots[i] ?? null,
            );
      if (state.activeSlot === null) {
        return { ...state, slots };
      }
      return { ...state, slots, brush: slots[state.activeSlot] };
    }

    case 'swap-slots': {
      const { from, to } = action;
      const slots = state.slots
        .with(from, state.slots[to])
        .with(to, state.slots[from]);

      let activeSlot = state.activeSlot;
      if (activeSlot === from) {
        activeSlot = to;
      } else if (activeSlot === to) {
        activeSlot = from;
      }
      return { ...state, slots, activeSlot };
    }
  }
}

/** Returns the lowest N for which `bcf` has no actor with ID `${prefix}N`. */
function unusedIdNumber(bcf: BlertChartFormat, prefix: string): number {
  const ids = new Set(bcf.timeline.actors.map((a) => a.id));
  let n = 1;
  while (ids.has(`${prefix}${n}`)) {
    n++;
  }
  return n;
}

function defaultRowOrder(actors: BCFActor[]): string[] {
  const order: string[] = [];
  for (const actor of actors) {
    if (actor.type === 'npc') {
      order.push(actor.id);
    }
  }
  for (const actor of actors) {
    if (actor.type === 'player') {
      order.push(actor.id);
    }
  }
  return order;
}
