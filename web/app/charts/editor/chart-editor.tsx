'use client';

import { BCFAction, BCFResolver, BlertChartFormat } from '@blert/bcf';
import {
  RefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';

import BcfRenderer, {
  CellOverlay,
  InteractionHandler,
  PointerHit,
  RegionOverlay,
  TimelineDisplay,
} from '@/components/attack-timeline';
import Button from '@/components/button';
import DebugOverlay, {
  DebugRow,
  DebugSection,
} from '@/components/debug-overlay';
import { useModifierKey } from '@/hooks/modifier-key';
import { clamp } from '@/utils/math';

import { useActionDrag } from './action-drag';
import { ActionIcon } from './action-icon';
import { CooldownConflict, actionFillTicks, deriveState } from './attack-cycle';
import {
  CellDelta,
  CellRegion,
  addActor,
  clearCells,
  copyCells,
  duplicateActor,
  placeAction,
  removeAction,
  removeActor,
  removeCell,
  renameActor,
  setRowOrder,
  validateTranslation,
} from './bcf-mutator';
import { CellBar } from './cell-bar';
import { COPY_FLASH_MS, MIN_CELL_SIZE, MAX_CELL_SIZE } from './constants';
import { DismissButton } from './dismiss-button';
import {
  actorCopy,
  CellCoord,
  CellRange,
  currentDocument,
  displayWindow,
  EditorAction,
  EditorState,
  newPlayer,
  rangeToRegion,
} from './editor-state';
import { Hotbar } from './hotbar';
import {
  Drag,
  Fill,
  InputContext,
  Keypress,
  Move,
  applyFill,
  autoScrollSpeed,
  canPlace,
  cellsClearedBy,
  deltaOfMove,
  extendDrag,
  hasPassedDragThreshold,
  keyIntents,
  pressIntents,
} from './input';
import { Palette } from './palette';
import { RowsPanel } from './rows-panel';
import { Toolbar } from './toolbar';
import { useChartEditor } from './use-chart-editor';

import styles from './chart-editor.module.scss';

const DEFAULT_CELL_SIZE = 30;

const DEFAULT_CHART: BlertChartFormat = {
  version: '1.0',
  name: 'Untitled chart',
  config: { totalTicks: 51, startTick: 1, rowOrder: ['verzik', 'p1'] },
  timeline: {
    actors: [
      { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik Vitur' },
      { type: 'player', id: 'p1', name: 'Player 1' },
    ],
    ticks: [],
  },
};

type ConflictSpan = { actorId: string; endTick: number; startTick: number };

/**
 * Returns the tick spans that attacks spend inside an earlier attack's
 * cooldown, merging each actor's overlapping and adjacent spans.
 * `conflicts` must be in tick order.
 */
function findConflictSpans(conflicts: CooldownConflict[]): ConflictSpan[] {
  const spans: ConflictSpan[] = [];
  const latest = new Map<string, ConflictSpan>();
  for (const { actorId, offCooldownTick, tick } of conflicts) {
    const span = latest.get(actorId);
    if (span !== undefined && tick <= span.endTick + 1) {
      span.endTick = Math.max(span.endTick, offCooldownTick - 1);
    } else {
      const next = { actorId, endTick: offCooldownTick - 1, startTick: tick };
      spans.push(next);
      latest.set(actorId, next);
    }
  }
  return spans;
}

function keyTarget(target: EventTarget | null): Keypress['target'] {
  if (
    (target instanceof HTMLInputElement && target.type !== 'checkbox') ||
    target instanceof HTMLTextAreaElement
  ) {
    return 'text';
  }
  return target === document.body ? 'body' : 'control';
}

type Drawer = { open: boolean; panel: 'actions' | 'rows' };

export function ChartEditor() {
  const editor = useChartEditor(DEFAULT_CHART);
  const { dispatch, lastAction, slotsLoaded, state, update } = editor;
  const [drawer, setDrawer] = useState<Drawer>({
    open: true,
    panel: 'actions',
  });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [cellSize, rawSetCellSize] = useState(DEFAULT_CELL_SIZE);

  const setCellSize = useCallback((size: SetStateAction<number>) => {
    rawSetCellSize((previous) =>
      clamp(
        typeof size === 'function' ? size(previous) : size,
        MIN_CELL_SIZE,
        MAX_CELL_SIZE,
      ),
    );
  }, []);

  const toggleDrawer = useCallback((panel: Drawer['panel']) => {
    setDrawer((current) =>
      current.open && current.panel === panel
        ? { ...current, open: false }
        : { open: true, panel },
    );
  }, []);

  const bcf = currentDocument(state);
  const resolver = useMemo(() => new BCFResolver(bcf), [bcf]);

  // Derived state is local to the renderer and not used in edits.
  const { conflicts, conflictSpans, derivedResolver, derivedDisplay } =
    useMemo(() => {
      const derived = structuredClone(bcf);
      const conflicts = deriveState(derived);
      const derivedResolver = new BCFResolver(derived);
      return {
        conflicts,
        conflictSpans: findConflictSpans(conflicts),
        derivedResolver,
        derivedDisplay: new TimelineDisplay(derivedResolver),
      };
    }, [bcf]);
  const {
    activeSlot,
    brush,
    focus,
    focusedBy,
    respectCooldowns,
    selection,
    slots,
  } = state;

  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = gridRef.current;
    if (element === null) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setGridWidth(Math.floor(entry.contentRect.width));
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const focusRef = useScrollIntoView(focus);
  const selectionEndRef = useScrollIntoView(selection?.end);

  const searchRef = useRef<HTMLInputElement | null>(null);

  const [hover, setHover] = useState<CellCoord | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragging = drag?.dragging === true;

  const [lastHit, setLastHit] = useState<string | null>(null);
  const [rejection, setRejection] = useState<
    | {
        type: 'slot';
        at: number;
        focus: CellCoord;
        invalid: boolean;
        slot: number;
      }
    | { type: 'move'; at: number; range: CellRange; delta: CellDelta }
    | null
  >(null);
  const [copied, flashCopied] = useFlash<{ at: number; range: CellRange }>(
    COPY_FLASH_MS,
  );
  const altHeld = useModifierKey('Alt');
  const { capture, drag: actionDrag, release } = useActionDrag();

  const place = useCallback(
    (cell: CellCoord, action: BCFAction) => {
      if (canPlace(resolver, cell.actorId, action)) {
        update((doc) => placeAction(doc, cell.actorId, cell.tick, action));
        dispatch({ type: 'set-focus', focus: cell });
      }
    },
    [dispatch, resolver, update],
  );

  useEffect(() => {
    if (drag === null) {
      return;
    }

    const commit = () => {
      setDrag(null);
      if (drag.type === 'marquee') {
        if (dragging) {
          dispatch({ type: 'set-selection', selection: drag.range });
        }
        return;
      }
      if (drag.type === 'move') {
        if (!dragging) {
          dispatch({ type: 'set-focus', focus: drag.originCell });
          return;
        }
        const delta = deltaOfMove(bcf, drag);
        if (delta.rows !== 0 || delta.ticks !== 0) {
          const at = Date.now();
          dispatch({
            type: 'move-cells',
            range: drag.range,
            ...delta,
            focusedBy: 'pointer',
            at,
          });
        }
        return;
      }

      const { action, range } = drag;
      const ticks = actionFillTicks(
        action,
        range.start.tick,
        range.end.tick,
        respectCooldowns,
      );
      update((doc) => applyFill(doc, drag, respectCooldowns));
      const tick = ticks[ticks.length - 1];
      dispatch({
        type: 'set-focus',
        focus: { actorId: range.end.actorId, tick },
      });
    };
    const cancel = () => setDrag(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancel();
      }
    };

    window.addEventListener('pointerup', commit);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerup', commit);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [bcf, dispatch, drag, dragging, respectCooldowns, update]);

  const pointerY = useAutoScroll(gridRef, dragging);

  const moving = dragging && drag.type === 'move';

  const interactionHandler = useMemo<InteractionHandler>(
    () => ({
      onPointerDown: (hit, e) => {
        if (e.button !== 0 || hit === null || hit.type === 'tick-header') {
          return;
        }

        const intents = pressIntents(
          { bcf, brush, resolver, selection },
          { altKey: e.altKey, hit, shiftKey: e.shiftKey },
        );
        const origin = { x: e.clientX, y: e.clientY };
        for (const intent of intents) {
          switch (intent.type) {
            case 'start-fill': {
              const { action, cell } = intent;
              const range = { start: cell, end: cell };
              setDrag({ type: 'fill', action, dragging: false, origin, range });
              break;
            }

            case 'start-marquee': {
              const { cell } = intent;
              const range = { start: cell, end: cell };
              setDrag({ type: 'marquee', dragging: false, origin, range });
              break;
            }

            case 'start-move': {
              const { cell, range } = intent;
              setDrag({
                type: 'move',
                dragging: false,
                origin,
                range,
                originCell: cell,
                hoveredCell: cell,
              });
              break;
            }

            default:
              dispatch(intent);
          }
        }
      },
      onPointerMove: (hit, e) => {
        pointerY.current = e.clientY;
        setLastHit(describeHit(hit));
        setHover((previous) => {
          if (hit?.type !== 'cell') {
            return null;
          }
          if (
            previous !== null &&
            previous.actorId === hit.rowId &&
            previous.tick === hit.tick
          ) {
            return previous;
          }
          return { actorId: hit.rowId, tick: hit.tick };
        });
        const point = { x: e.clientX, y: e.clientY };
        setDrag((previous) => {
          if (previous === null) {
            return null;
          }
          if (previous.dragging) {
            return extendDrag(resolver, previous, hit);
          }
          if (!hasPassedDragThreshold(previous.origin, point)) {
            return previous;
          }
          return extendDrag(resolver, { ...previous, dragging: true }, hit);
        });

        if (actionDrag === null) {
          return;
        }
        if (hit?.type === 'cell') {
          const cell = { actorId: hit.rowId, tick: hit.tick };
          capture('chart', ({ action }) => place(cell, action));
        } else {
          release('chart');
        }
      },
      cursor: (hit) => {
        if (moving) {
          return 'grabbing';
        }
        if (hit === null || hit.type === 'tick-header') {
          return undefined;
        }
        if (hit.type === 'cell') {
          if (altHeld) {
            return resolver.getCell(hit.rowId, hit.tick) !== undefined
              ? 'copy'
              : undefined;
          }
          if (brush !== null && !canPlace(resolver, hit.rowId, brush)) {
            return 'not-allowed';
          }
        }
        const intents = pressIntents(
          { bcf, brush, resolver, selection },
          { altKey: altHeld, hit, shiftKey: false },
        );
        if (intents.some((intent) => intent.type === 'start-move')) {
          return 'grab';
        }
        return hit.type === 'cell' ? 'cell' : undefined;
      },
    }),
    [
      actionDrag,
      altHeld,
      bcf,
      brush,
      capture,
      dispatch,
      moving,
      place,
      pointerY,
      release,
      resolver,
      selection,
    ],
  );

  const wrapWidth = gridWidth !== null && gridWidth > 0 ? gridWidth : undefined;

  const removeFocusedAction = useCallback(
    (index: number) => {
      if (focus !== null) {
        update((doc) => removeAction(doc, focus.actorId, focus.tick, index));
      }
    },
    [focus, update],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const context: InputContext = {
        at: Date.now(),
        derivedResolver,
        resolver,
        state,
      };
      const target = keyTarget(e.target);
      const intents = keyIntents(context, {
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        key: e.key,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        target,
      });
      const altArrow =
        e.altKey && e.key.startsWith('Arrow') && target !== 'text';
      if (intents.length > 0 || altArrow) {
        e.preventDefault();
      }

      for (const intent of intents) {
        switch (intent.type) {
          case 'clear-cells': {
            const { range } = intent;
            update((doc) => clearCells(doc, rangeToRegion(doc, range)));
            break;
          }

          case 'copy':
            dispatch(intent);
            flashCopied({ at: context.at, range: intent.range });
            break;

          case 'open-search':
            flushSync(() => setDrawer({ open: true, panel: 'actions' }));
            searchRef.current?.focus({ preventScroll: true });
            break;

          case 'reject-move':
            setRejection({
              type: 'move',
              at: context.at,
              range: intent.range,
              delta: intent.delta,
            });
            break;

          case 'reject-slot': {
            const { focus, invalid, slot } = intent;
            setRejection({
              type: 'slot',
              at: context.at,
              focus,
              invalid,
              slot,
            });
            break;
          }

          case 'remove-cell': {
            const { actorId, tick } = intent.cell;
            update((doc) => removeCell(doc, actorId, tick));
            break;
          }

          case 'rename-row':
            setDrawer({ open: true, panel: 'rows' });
            setRenaming(intent.actorId);
            break;

          case 'toggle-drawer':
            toggleDrawer(intent.panel);
            break;

          case 'zoom': {
            const { delta } = intent;
            setCellSize((size) => size + delta);
            break;
          }

          default:
            dispatch(intent);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    derivedResolver,
    dispatch,
    flashCopied,
    resolver,
    setCellSize,
    state,
    toggleDrawer,
    update,
  ]);

  const focusActor = (actorId: string) => {
    const tick = focus?.tick ?? displayWindow(bcf)[0];
    dispatch({ type: 'set-focus', focus: { actorId, tick } });
  };

  let refusedMoveClass = '';
  if (rejection?.type === 'move') {
    refusedMoveClass = ` ${styles.rejected}`;
    if (Math.abs(rejection.delta.rows) > Math.abs(rejection.delta.ticks)) {
      refusedMoveClass += ` ${styles.vertical}`;
    }
  }

  let focusClass = styles.focusOverlay;
  if (focusedBy === 'keyboard') {
    focusClass += ` ${styles.keyboard}`;
  }
  if (rejection?.type === 'slot' && rejection.focus === focus) {
    focusClass += ` ${styles.rejected}`;
    if (rejection.invalid) {
      focusClass += ` ${styles.invalid}`;
    }
  }
  if (
    rejection?.type === 'move' &&
    selection === null &&
    rejection.range.start === focus
  ) {
    focusClass += `${refusedMoveClass} ${styles.invalid}`;
  }

  let selectionClass = styles.selection;
  if (rejection?.type === 'move' && rejection.range === selection) {
    selectionClass += refusedMoveClass;
  }

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <Toolbar
          editor={editor}
          cellSize={cellSize}
          onCellSizeChange={setCellSize}
        >
          <Button
            aria-pressed={drawer.open && drawer.panel === 'rows'}
            icon
            onClick={() => toggleDrawer('rows')}
            toolbar
            tooltip="Rows (R)"
          >
            <i className="fa-solid fa-users" />
            <span className="sr-only">Rows</span>
          </Button>
          <Button
            aria-pressed={drawer.open && drawer.panel === 'actions'}
            icon
            onClick={() => toggleDrawer('actions')}
            toolbar
            tooltip="Actions (A)"
          >
            <i className="fa-solid fa-table-cells" />
            <span className="sr-only">Actions</span>
          </Button>
        </Toolbar>
      </div>
      <div className={styles.cellBar}>
        <CellBar
          conflicts={conflicts}
          focus={focus}
          onRemoveAction={removeFocusedAction}
          resolver={resolver}
        />
      </div>
      <div className={styles.grid} ref={gridRef}>
        <BcfRenderer
          resolver={derivedResolver}
          display={derivedDisplay}
          cellSize={cellSize}
          wrapWidth={wrapWidth}
          interactionHandler={interactionHandler}
          tooltipId="chart-editor"
        >
          {conflictSpans.map((span) => (
            <RegionOverlay
              className={styles.conflict}
              endRowId={span.actorId}
              endTick={span.endTick}
              key={`${span.actorId}:${span.startTick}`}
              startRowId={span.actorId}
              startTick={span.startTick}
            />
          ))}
          {selection !== null && (
            <RegionOverlay
              className={selectionClass}
              endRowId={selection.end.actorId}
              key={rejection?.type === 'move' ? rejection.at : undefined}
              endTick={selection.end.tick}
              startRowId={selection.start.actorId}
              startTick={selection.start.tick}
            />
          )}
          {selection !== null && (
            <CellOverlay
              ref={selectionEndRef}
              rowId={selection.end.actorId}
              tick={selection.end.tick}
            />
          )}
          {copied !== null && (
            <RegionOverlay
              className={styles.copied}
              endRowId={copied.range.end.actorId}
              endTick={copied.range.end.tick}
              key={copied.at}
              startRowId={copied.range.start.actorId}
              startTick={copied.range.start.tick}
            />
          )}
          {focus !== null && (
            <CellOverlay
              className={focusClass}
              key={
                rejection?.type === 'slot' || selection === null
                  ? rejection?.at
                  : undefined
              }
              ref={focusRef}
              rowId={focus.actorId}
              tick={focus.tick}
            />
          )}
          {drag === null && (
            <Ghost
              hover={hover}
              brush={actionDrag?.action ?? brush}
              altHeld={altHeld}
              bcf={bcf}
              resolver={resolver}
              cellSize={cellSize}
            />
          )}
          {drag?.type === 'fill' && (
            <FillPreview
              bcf={bcf}
              cellSize={cellSize}
              fill={drag}
              respectCooldowns={respectCooldowns}
            />
          )}
          {dragging && drag?.type === 'marquee' && (
            <RegionOverlay
              className={styles.fillRegion}
              endRowId={drag.range.end.actorId}
              endTick={drag.range.end.tick}
              startRowId={drag.range.start.actorId}
              startTick={drag.range.start.tick}
            />
          )}
          {dragging && drag?.type === 'move' && (
            <MovePreview bcf={bcf} cellSize={cellSize} move={drag} />
          )}
        </BcfRenderer>
      </div>
      <aside
        className={
          drawer.open ? `${styles.drawer} ${styles.open}` : styles.drawer
        }
        inert={!drawer.open}
      >
        <div className={styles.drawerHeader}>
          <span className={styles.drawerTitle}>
            {drawer.panel === 'rows' ? 'Rows' : 'Actions'}
          </span>
          <DismissButton
            label="Close"
            onClick={() =>
              setDrawer((current) => ({ ...current, open: false }))
            }
          />
        </div>
        {drawer.panel === 'rows' ? (
          <RowsPanel
            bcf={bcf}
            focusedActorId={focus?.actorId ?? null}
            onAddPlayer={() => {
              const player = newPlayer(bcf);
              update((doc) => addActor(doc, player));
              focusActor(player.id);
            }}
            onDuplicateActor={(actor) => {
              const copy = actorCopy(bcf, actor);
              update((doc) =>
                duplicateActor(doc, actor.id, copy.id, copy.name),
              );
            }}
            onFocusActor={focusActor}
            onRemoveActor={(actorId) =>
              update((doc) => removeActor(doc, actorId))
            }
            onRenameActor={(actorId, name) => {
              setRenaming(null);
              update((doc) => renameActor(doc, actorId, name));
            }}
            onRenamingChange={setRenaming}
            onReorderRows={(rowOrder) =>
              update((doc) => setRowOrder(doc, rowOrder))
            }
            renamingActorId={renaming}
          />
        ) : (
          <Palette
            brush={brush}
            onAddToHotbar={(action) => {
              if (slotsLoaded) {
                dispatch({ type: 'add-to-hotbar', action });
              }
            }}
            onSelect={(action) =>
              dispatch({ type: 'set-brush', brush: action })
            }
            searchRef={searchRef}
          />
        )}
      </aside>
      <div className={styles.hotbar}>
        <Hotbar
          activeSlot={activeSlot}
          brush={brush}
          disabled={!slotsLoaded}
          onClearBrush={() => dispatch({ type: 'set-brush', brush: null })}
          onRespectCooldownsChange={(respectCooldowns) =>
            dispatch({ type: 'set-respect-cooldowns', respectCooldowns })
          }
          onSelectSlot={(slot) => {
            if (slots[slot] === null && brush !== null) {
              dispatch({ type: 'set-slot', slot, action: brush });
            }
            dispatch({ type: 'select-slot', slot });
          }}
          onSetSlot={(slot, action) =>
            dispatch({ type: 'set-slot', slot, action })
          }
          onSwapSlots={(from, to) => dispatch({ type: 'swap-slots', from, to })}
          pulse={
            rejection?.type === 'slot' && !rejection.invalid ? rejection : null
          }
          respectCooldowns={respectCooldowns}
          slots={slots}
        />
      </div>
      <EditorDebug
        gridWidth={gridWidth}
        hit={lastHit}
        lastAction={lastAction}
        state={state}
      />
    </div>
  );
}

type GhostProps = {
  hover: CellCoord | null;
  brush: BCFAction | null;
  altHeld: boolean;
  bcf: BlertChartFormat;
  resolver: BCFResolver;
  cellSize: number;
};

function Ghost({ hover, brush, altHeld, bcf, resolver, cellSize }: GhostProps) {
  if (altHeld) {
    return bcf.timeline.ticks.flatMap((tick) =>
      tick.cells
        .filter((cell) => (cell.actions?.length ?? 0) > 0)
        .map((cell) => {
          const hovered =
            hover !== null &&
            hover.actorId === cell.actorId &&
            hover.tick === tick.tick;
          return (
            <CellOverlay
              key={`${cell.actorId}:${tick.tick}`}
              rowId={cell.actorId}
              tick={tick.tick}
              className={`${styles.ghost} ${hovered ? styles.pick : styles.hint}`}
            />
          );
        }),
    );
  }

  if (hover === null || brush === null) {
    return null;
  }

  const valid = canPlace(resolver, hover.actorId, brush);
  return (
    <CellOverlay
      rowId={hover.actorId}
      tick={hover.tick}
      className={`${styles.ghost} ${valid ? styles.valid : styles.invalid}`}
    >
      <ActionIcon action={brush} size={cellSize - 2} />
    </CellOverlay>
  );
}

type FillPreviewProps = {
  bcf: BlertChartFormat;
  cellSize: number;
  fill: Fill;
  respectCooldowns: boolean;
};

function FillPreview({
  bcf,
  cellSize,
  fill,
  respectCooldowns,
}: FillPreviewProps) {
  const { action, range } = fill;
  const { end, start } = range;
  const ticks = actionFillTicks(action, start.tick, end.tick, respectCooldowns);
  const { actorIds } = rangeToRegion(bcf, range);
  const cleared = cellsClearedBy(bcf, fill, respectCooldowns);

  return (
    <>
      <RegionOverlay
        className={styles.fillRegion}
        endRowId={end.actorId}
        endTick={end.tick}
        startRowId={start.actorId}
        startTick={start.tick}
      />
      {cleared.map(({ actorId, tick }) => (
        <CellOverlay
          className={styles.removed}
          key={`${actorId}:${tick}`}
          rowId={actorId}
          tick={tick}
        />
      ))}
      {actorIds.flatMap((actorId) =>
        ticks.map((tick) => (
          <CellOverlay
            className={`${styles.ghost} ${styles.valid}`}
            key={`${actorId}:${tick}`}
            rowId={actorId}
            tick={tick}
          >
            <ActionIcon action={action} size={cellSize - 2} />
          </CellOverlay>
        )),
      )}
    </>
  );
}

type MovePreviewProps = {
  bcf: BlertChartFormat;
  cellSize: number;
  move: Move;
};

function MovePreview({ bcf, cellSize, move }: MovePreviewProps) {
  const rowOrder = bcf.config.rowOrder ?? [];
  const delta = deltaOfMove(bcf, move);
  const source = rangeToRegion(bcf, move.range);
  const copy = copyCells(bcf, source);
  const { valid } = validateTranslation(bcf, source, delta);

  const firstRow = rowOrder.indexOf(source.actorIds[0]) + delta.rows;
  const destination: CellRegion = {
    actorIds: rowOrder.slice(firstRow, firstRow + source.actorIds.length),
    startTick: source.startTick + delta.ticks,
    endTick: source.endTick + delta.ticks,
  };

  // Dropping clears the source cells and every cell in the target region.
  const cleared = new Map<string, CellCoord>();
  for (const region of [source, destination]) {
    for (const { rowOffset, tickOffset } of copyCells(bcf, region).cells) {
      const actorId = region.actorIds[rowOffset];
      const tick = region.startTick + tickOffset;
      cleared.set(`${actorId}:${tick}`, { actorId, tick });
    }
  }

  const ghostClass = `${styles.ghost} ${valid ? styles.valid : styles.invalid}`;
  return (
    <>
      <RegionOverlay
        className={`${styles.fillRegion} ${valid ? '' : styles.invalid}`}
        endRowId={destination.actorIds[destination.actorIds.length - 1]}
        endTick={destination.endTick}
        startRowId={destination.actorIds[0]}
        startTick={destination.startTick}
      />
      {Array.from(cleared.values(), ({ actorId, tick }) => (
        <CellOverlay
          className={styles.removed}
          key={`${actorId}:${tick}`}
          rowId={actorId}
          tick={tick}
        />
      ))}
      {copy.cells.map(({ cell, rowOffset, tickOffset }) => {
        const actions = cell.actions ?? [];
        const shown = actions.find((a) => a.type === 'attack') ?? actions[0];
        if (shown === undefined) {
          return null;
        }
        const actorId = destination.actorIds[rowOffset];
        const tick = destination.startTick + tickOffset;
        return (
          <CellOverlay
            className={ghostClass}
            key={`${actorId}:${tick}`}
            rowId={actorId}
            tick={tick}
          >
            <ActionIcon action={shown} size={cellSize - 2} />
          </CellOverlay>
        );
      })}
    </>
  );
}

type EditorDebugProps = {
  gridWidth: number | null;
  hit: string | null;
  lastAction: EditorAction | null;
  state: EditorState;
};

function EditorDebug({ gridWidth, hit, lastAction, state }: EditorDebugProps) {
  const { coalesce } = state;

  let action = lastAction?.type ?? null;
  if (lastAction?.type === 'update' && lastAction.coalesce !== undefined) {
    action += ` · ${lastAction.coalesce}`;
  }

  return (
    <DebugOverlay>
      <DebugSection title="History">
        <DebugRow label="position" value={state.position} />
        <DebugRow label="entries" value={state.history.length} />
        <DebugRow
          label="coalescing"
          value={
            coalesce !== null && coalesce.position === state.position
              ? coalesce.key
              : null
          }
        />
        <DebugRow label="last action" value={action} />
      </DebugSection>
      <DebugSection title="Chart">
        <DebugRow
          label="stored ticks"
          value={currentDocument(state).timeline.ticks.length}
        />
        <DebugRow label="hit" value={hit} />
        <DebugRow label="grid width" value={gridWidth} />
      </DebugSection>
    </DebugOverlay>
  );
}

/**
 * Returns a ref whose element is scrolled into view each time `target` changes.
 */
function useScrollIntoView(target: unknown): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, [target]);
  return ref;
}

/**
 * Scrolls `container` while `active` and the pointer is near its top or bottom
 * edge. The caller writes the pointer's latest client Y to the returned ref.
 */
function useAutoScroll(
  container: RefObject<HTMLElement | null>,
  active: boolean,
): RefObject<number | null> {
  const pointerY = useRef<number | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!active || element === null) {
      return;
    }

    let frame = 0;
    let last: number | null = null;
    let distance = 0;
    const scroll = (now: number) => {
      const y = pointerY.current;
      const { bottom, top } = element.getBoundingClientRect();
      const speed = y === null ? 0 : autoScrollSpeed(top, bottom, y);
      if (last !== null) {
        distance += (speed * (now - last)) / 1000;
      }
      last = now;
      const pixels = Math.trunc(distance);
      distance -= pixels;
      element.scrollTop += pixels;
      frame = requestAnimationFrame(scroll);
    };

    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [active, container]);

  return pointerY;
}

/**
 * Returns state that resets to `null` `durationMs` after each time it is set.
 */
function useFlash<T>(durationMs: number): [T | null, (value: T) => void] {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (value === null) {
      return;
    }
    const timeout = setTimeout(() => setValue(null), durationMs);
    return () => clearTimeout(timeout);
  }, [durationMs, value]);
  return [value, setValue];
}

function describeHit(hit: PointerHit | null): string | null {
  if (hit === null) {
    return null;
  }
  if (hit.type === 'tick-header') {
    return `tick header ${hit.tick}`;
  }
  const cell = `${hit.rowId}:${hit.tick} (row ${hit.rowIndex})`;
  return hit.type === 'nearest-cell' ? `nearest cell ${cell}` : `cell ${cell}`;
}
