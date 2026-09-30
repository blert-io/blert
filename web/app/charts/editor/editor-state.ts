import { BCFAction, BCFActor, BlertChartFormat } from '@blert/bcf';

import { clamp } from '@/utils/math';

import { setRowOrder } from './bcf-mutator';

export type CellCoord = { actorId: string; tick: number };

export type EditorState = {
  history: BlertChartFormat[];
  position: number;
  /**
   * Marks the head history entry as combinable with consecutive updates
   * sharing the same key, so they undo together.
   * Only valid while `position` matches the entry.
   */
  coalesce: { key: string; position: number; at: number } | null;

  modified: boolean;
  focus: CellCoord | null;
  brush: BCFAction | null;
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
      at: number;
    }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'set-focus'; focus: CellCoord | null }
  | { type: 'move-focus'; rows: number; ticks: number }
  | { type: 'set-brush'; brush: BCFAction | null };

// Maximum temporal gap between coalescing edits to combine them.
const COALESCE_WINDOW_MS = 2500;

export function currentDocument(state: EditorState): BlertChartFormat {
  return state.history[state.position];
}

export function initialState(bcf: BlertChartFormat): EditorState {
  const document =
    bcf.config.rowOrder === undefined
      ? setRowOrder(bcf, defaultRowOrder(bcf.timeline.actors))
      : bcf;

  return {
    history: [document],
    position: 0,
    coalesce: null,
    modified: false,
    focus: null,
    brush: null,
    respectCooldowns: true,
  };
}

export function reduce(state: EditorState, action: EditorAction): EditorState {
  return normalize(apply(state, action));
}

/** Clamps focus to within the current document. */
function normalize(state: EditorState): EditorState {
  if (state.focus === null) {
    return state;
  }

  const bcf = currentDocument(state);
  if (!bcf.timeline.actors.some((a) => a.id === state.focus!.actorId)) {
    return { ...state, focus: null };
  }

  const [first, last] = displayWindow(bcf);
  const tick = clamp(state.focus.tick, first, last);
  if (tick === state.focus.tick) {
    return state;
  }
  return { ...state, focus: { actorId: state.focus.actorId, tick } };
}

function apply(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'update': {
      const updated = action.mutate(currentDocument(state));
      const key = action.coalesce ?? null;

      if (
        key !== null &&
        state.position === state.history.length - 1 &&
        state.coalesce?.key === key &&
        state.coalesce.position === state.position &&
        action.at - state.coalesce.at <= COALESCE_WINDOW_MS
      ) {
        return {
          ...state,
          history: [...state.history.slice(0, state.position), updated],
          coalesce: { ...state.coalesce, at: action.at },
          modified: true,
        };
      }

      return {
        ...state,
        history: [...state.history.slice(0, state.position + 1), updated],
        position: state.position + 1,
        coalesce:
          key !== null
            ? { key, position: state.position + 1, at: action.at }
            : null,
        modified: true,
      };
    }

    case 'undo':
      if (state.position === 0) {
        return state;
      }
      return {
        ...state,
        position: state.position - 1,
        coalesce: null,
        modified: true,
      };

    case 'redo':
      if (state.position === state.history.length - 1) {
        return state;
      }
      return {
        ...state,
        position: state.position + 1,
        coalesce: null,
        modified: true,
      };

    case 'set-focus':
      return { ...state, focus: action.focus };

    case 'move-focus': {
      const bcf = currentDocument(state);
      const rowOrder = bcf.config.rowOrder ?? [];
      const [first, last] = displayWindow(bcf);

      if (state.focus === null) {
        if (rowOrder.length === 0) {
          return state;
        }
        return { ...state, focus: { actorId: rowOrder[0], tick: first } };
      }

      const row = rowOrder.indexOf(state.focus.actorId);
      if (row === -1) {
        return state;
      }

      const nextRow = clamp(row + action.rows, 0, rowOrder.length - 1);
      const tick = clamp(state.focus.tick + action.ticks, first, last);
      if (nextRow === row && tick === state.focus.tick) {
        return state;
      }
      return { ...state, focus: { actorId: rowOrder[nextRow], tick } };
    }

    case 'set-brush':
      return { ...state, brush: action.brush };
  }
}

function displayWindow(bcf: BlertChartFormat): [number, number] {
  return [
    bcf.config.startTick ?? 0,
    bcf.config.endTick ?? bcf.config.totalTicks - 1,
  ];
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
