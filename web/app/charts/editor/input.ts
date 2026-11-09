import {
  BCFAction,
  BCFResolver,
  BlertChartFormat,
  actorTypeSupportsAction,
} from '@blert/bcf';

import { PointerHit } from '@/components/attack-timeline';

import { cycleAttack } from './action-registry';
import { actionFillTicks, findOffCooldownTick } from './attack-cycle';
import { clearActions, placeActions } from './bcf-mutator';
import {
  AUTO_SCROLL_MAX_SPEED_PX_PER_S,
  AUTO_SCROLL_ZONE_PX,
  DRAG_THRESHOLD_PX,
} from './constants';
import {
  CellCoord,
  CellRange,
  EditorAction,
  EditorState,
  currentDocument,
  displayWindow,
  rangeToRegion,
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

export type CanvasPoint = { x: number; y: number };

/** A primary button press on a cell. */
export type Press = { altKey: boolean; cell: CellCoord };

/** An in-progress fill of an action over a range of cells. */
export type Fill = {
  type: 'fill';
  action: BCFAction;
  dragging: boolean;
  origin: CanvasPoint;
  range: CellRange;
};

/** An in-progress selection of a range of cells. */
export type Marquee = {
  type: 'marquee';
  dragging: boolean;
  origin: CanvasPoint;
  range: CellRange;
};

/** An in-progress pointer drag over the chart. */
export type Drag = Fill | Marquee;

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
      | 'extend-selection'
      | 'move-focus'
      | 'place-slot-at-focus'
      | 'redo'
      | 'select-slot'
      | 'set-brush'
      | 'set-focus'
      | 'set-selection'
      | 'undo';
  }
>;

export type KeyIntent =
  | EditorIntent
  | { type: 'clear-cells'; range: CellRange }
  | { type: 'open-search' }
  | { type: 'reject-slot'; focus: CellCoord; invalid: boolean; slot: number }
  | { type: 'remove-cell'; cell: CellCoord }
  | { type: 'rename-row'; actorId: string }
  | { type: 'toggle-drawer'; panel: 'actions' | 'rows' }
  | { type: 'zoom'; delta: number };

export type PressIntent =
  | Extract<EditorAction, { type: 'set-brush' }>
  | { type: 'start-fill'; action: BCFAction; cell: CellCoord }
  | { type: 'start-marquee'; cell: CellCoord };

/**
 * Applies `fill` to every row in its range.
 * Filling with an attack first clears existing attacks in the range.
 */
export function applyFill(
  bcf: BlertChartFormat,
  fill: Fill,
  respectCooldowns: boolean,
): BlertChartFormat {
  const { action, range } = fill;
  const region = rangeToRegion(bcf, range);
  const ticks = actionFillTicks(
    action,
    range.start.tick,
    range.end.tick,
    respectCooldowns,
  );

  let next =
    action.type === 'attack' ? clearActions(bcf, region, 'attack') : bcf;
  for (const actorId of region.actorIds) {
    next = placeActions(next, actorId, ticks, action);
  }
  return next;
}

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

/** Returns the cells that `applyFill` would clear if run on `fill`. */
export function cellsClearedBy(
  bcf: BlertChartFormat,
  fill: Fill,
  respectCooldowns: boolean,
): CellCoord[] {
  const { action, range } = fill;
  if (action.type !== 'attack') {
    return [];
  }

  const region = rangeToRegion(bcf, range);
  const actorIds = new Set(region.actorIds);
  const landings = new Set(
    actionFillTicks(action, range.start.tick, range.end.tick, respectCooldowns),
  );

  const cleared: CellCoord[] = [];
  for (const { cells, tick } of bcf.timeline.ticks) {
    if (
      tick < region.startTick ||
      tick > region.endTick ||
      landings.has(tick)
    ) {
      continue;
    }
    for (const { actions, actorId } of cells) {
      if (actorIds.has(actorId) && actions?.some((a) => a.type === 'attack')) {
        cleared.push({ actorId, tick });
      }
    }
  }
  return cleared;
}

/**
 * Returns whether a pointer pressed at `origin` and now at `point` has moved
 * far enough to count as a drag rather than a click.
 */
export function hasPassedDragThreshold(
  origin: CanvasPoint,
  point: CanvasPoint,
): boolean {
  const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
  return distance >= DRAG_THRESHOLD_PX;
}

/**
 * Returns the speed, in pixels per second, at which to scroll a container
 * spanning `top` to `bottom` while dragging with the pointer at `y`. Speeds are
 * negative near the top edge, positive near the bottom edge, faster closer to
 * the edge, and 0 elsewhere.
 */
export function autoScrollSpeed(
  top: number,
  bottom: number,
  y: number,
): number {
  const down = (y - (bottom - AUTO_SCROLL_ZONE_PX)) / AUTO_SCROLL_ZONE_PX;
  if (down > 0) {
    return Math.min(down, 1) * AUTO_SCROLL_MAX_SPEED_PX_PER_S;
  }
  const up = (top + AUTO_SCROLL_ZONE_PX - y) / AUTO_SCROLL_ZONE_PX;
  if (up > 0) {
    return -Math.min(up, 1) * AUTO_SCROLL_MAX_SPEED_PX_PER_S;
  }
  return 0;
}

/**
 * Returns a copy of `drag` with its `end` set to the cell under `hit`.
 * If the end cell did not move, or `hit` is not valid, returns `drag`.
 * If `drag` is a fill, it is limited to actor rows of the same type as its
 * start row.
 */
export function extendDrag(
  resolver: BCFResolver,
  drag: Drag,
  hit: PointerHit | null,
): Drag {
  if (hit === null) {
    return drag;
  }

  const { end, start } = drag.range;
  let actorId = hit.type === 'tick-header' ? end.actorId : hit.rowId;
  if (drag.type === 'fill') {
    actorId = clampToActorType(resolver, start.actorId, actorId);
  }
  if (actorId === end.actorId && hit.tick === end.tick) {
    return drag;
  }
  return { ...drag, range: { start, end: { actorId, tick: hit.tick } } };
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
  const { activeSlot, brush, focus, focusedBy, selection, slots } = state;
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

  if ((key === 'Delete' || key === 'Backspace') && selection !== null) {
    return hasCells(bcf, selection)
      ? [{ type: 'clear-cells', range: selection }]
      : [];
  }

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
          type: shiftKey ? 'extend-selection' : 'move-focus',
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
      if (selection !== null) {
        return [{ type: 'set-selection', selection: null }];
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
    return { type: 'start-marquee', cell };
  }
  if (!canPlace(resolver, cell.actorId, brush)) {
    return null;
  }
  return { type: 'start-fill', action: brush, cell };
}

/**
 * Returns the row nearest to or including `toId` reachable from the row of
 * `fromId` without crossing a row of another actor type.
 */
function clampToActorType(
  resolver: BCFResolver,
  fromId: string,
  toId: string,
): string {
  const rowOrder = resolver.getRowOrder() ?? [];
  const from = rowOrder.indexOf(fromId);
  const to = rowOrder.indexOf(toId);
  if (from === -1 || to === -1) {
    return fromId;
  }

  const type = resolver.getActor(fromId)?.type;
  const direction = Math.sign(to - from);
  let row = from;
  while (
    row !== to &&
    resolver.getActor(rowOrder[row + direction])?.type === type
  ) {
    row += direction;
  }
  return rowOrder[row];
}

function hasCells(bcf: BlertChartFormat, range: CellRange): boolean {
  const { actorIds, endTick, startTick } = rangeToRegion(bcf, range);
  const actors = new Set(actorIds);
  return bcf.timeline.ticks.some(
    ({ cells, tick }) =>
      tick >= startTick &&
      tick <= endTick &&
      cells.some((cell) => actors.has(cell.actorId)),
  );
}
