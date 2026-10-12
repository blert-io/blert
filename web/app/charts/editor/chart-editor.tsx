'use client';

import { BCFAction, BCFResolver, BlertChartFormat } from '@blert/bcf';
import {
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
  HitTestResult,
  InteractionHandler,
  RegionOverlay,
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
  clearActions,
  placeAction,
  placeActions,
  removeAction,
  removeCell,
} from './bcf-mutator';
import { CellBar } from './cell-bar';
import { MIN_CELL_SIZE, MAX_CELL_SIZE } from './constants';
import {
  CellCoord,
  currentDocument,
  EditorAction,
  EditorState,
} from './editor-state';
import { Hotbar } from './hotbar';
import {
  Fill,
  InputContext,
  Keypress,
  canPlace,
  keyIntents,
  pressIntent,
} from './input';
import { Palette } from './palette';
import { Toolbar } from './toolbar';
import { useChartEditor } from './use-chart-editor';

import styles from './chart-editor.module.scss';

const DEFAULT_CELL_SIZE = 30;

const DEFAULT_CHART: BlertChartFormat = {
  version: '1.0',
  name: 'Untitled chart',
  config: { totalTicks: 31, startTick: 1, rowOrder: ['verzik', 'p1'] },
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

export function ChartEditor() {
  const editor = useChartEditor(DEFAULT_CHART);
  const { dispatch, lastAction, slotsLoaded, state, update } = editor;
  const [drawerOpen, setDrawerOpen] = useState(true);
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

  const bcf = currentDocument(state);
  const resolver = useMemo(() => new BCFResolver(bcf), [bcf]);

  // Derived state is local to the renderer and not used in edits.
  const { conflicts, conflictSpans, derived, derivedResolver } = useMemo(() => {
    const derived = structuredClone(bcf);
    const conflicts = deriveState(derived);
    return {
      conflicts,
      conflictSpans: findConflictSpans(conflicts),
      derived,
      derivedResolver: new BCFResolver(derived),
    };
  }, [bcf]);
  const { activeSlot, brush, focus, focusedBy, respectCooldowns, slots } =
    state;

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

  const focusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  const searchRef = useRef<HTMLInputElement | null>(null);

  const [hover, setHover] = useState<CellCoord | null>(null);
  const [fill, setFill] = useState<Fill | null>(null);
  const [lastHit, setLastHit] = useState<string | null>(null);
  const [rejection, setRejection] = useState<{
    at: number;
    focus: CellCoord;
    invalid: boolean;
    slot: number;
  } | null>(null);
  const altHeld = useModifierKey('Alt');
  const { capture, drag, release } = useActionDrag();

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
    if (fill === null) {
      return;
    }

    const { action, actorId, endTick, startTick } = fill;
    const commit = () => {
      const ticks = actionFillTicks(
        action,
        startTick,
        endTick,
        respectCooldowns,
      );
      const span = {
        actorIds: [actorId],
        startTick: Math.min(startTick, endTick),
        endTick: Math.max(startTick, endTick),
      };
      update((doc) => {
        const cleared =
          action.type === 'attack' ? clearActions(doc, span, 'attack') : doc;
        return placeActions(cleared, actorId, ticks, action);
      });
      const tick = ticks[ticks.length - 1];
      dispatch({ type: 'set-focus', focus: { actorId, tick } });
      setFill(null);
    };
    const cancel = () => setFill(null);
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
  }, [dispatch, fill, respectCooldowns, update]);

  const interactionHandler = useMemo<InteractionHandler>(
    () => ({
      onPointerDown: (hit, e) => {
        if (e.button !== 0 || hit?.type !== 'cell') {
          return;
        }

        const intent = pressIntent(
          { brush, resolver },
          { altKey: e.altKey, cell: { actorId: hit.rowId, tick: hit.tick } },
        );
        if (intent?.type === 'start-fill') {
          setFill(intent.fill);
        } else if (intent !== null) {
          dispatch(intent);
        }
      },
      onPointerMove: (hit) => {
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
        if (hit !== null) {
          setFill((previous) =>
            previous === null || previous.endTick === hit.tick
              ? previous
              : { ...previous, endTick: hit.tick },
          );
        }

        if (drag === null) {
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
        if (hit?.type !== 'cell') {
          return undefined;
        }
        if (altHeld) {
          return resolver.getCell(hit.rowId, hit.tick) !== undefined
            ? 'copy'
            : undefined;
        }
        if (brush !== null && !canPlace(resolver, hit.rowId, brush)) {
          return 'not-allowed';
        }
        return 'cell';
      },
    }),
    [altHeld, brush, capture, dispatch, drag, place, release, resolver],
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
      const intents = keyIntents(context, {
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        key: e.key,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        target: keyTarget(e.target),
      });
      if (intents.length > 0) {
        e.preventDefault();
      }

      for (const intent of intents) {
        switch (intent.type) {
          case 'open-search':
            flushSync(() => setDrawerOpen(true));
            searchRef.current?.focus({ preventScroll: true });
            break;

          case 'reject-slot': {
            const { focus, invalid, slot } = intent;
            setRejection({ at: context.at, focus, invalid, slot });
            break;
          }

          case 'remove-cell': {
            const { actorId, tick } = intent.cell;
            update((doc) => removeCell(doc, actorId, tick));
            break;
          }

          case 'toggle-drawer':
            setDrawerOpen((open) => !open);
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
  }, [derivedResolver, dispatch, resolver, setCellSize, state, update]);

  let focusClass = styles.focusOverlay;
  if (focusedBy === 'keyboard') {
    focusClass += ` ${styles.keyboard}`;
  }
  if (rejection !== null && rejection.focus === focus) {
    focusClass += ` ${styles.rejected}`;
    if (rejection.invalid) {
      focusClass += ` ${styles.invalid}`;
    }
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
            aria-pressed={drawerOpen}
            icon
            onClick={() => setDrawerOpen((open) => !open)}
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
          bcf={derived}
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
          {focus !== null && (
            <CellOverlay
              className={focusClass}
              key={rejection?.at}
              ref={focusRef}
              rowId={focus.actorId}
              tick={focus.tick}
            />
          )}
          {fill === null ? (
            <Ghost
              hover={hover}
              brush={drag?.action ?? brush}
              altHeld={altHeld}
              bcf={bcf}
              resolver={resolver}
              cellSize={cellSize}
            />
          ) : (
            <FillPreview
              cellSize={cellSize}
              fill={fill}
              resolver={resolver}
              respectCooldowns={respectCooldowns}
            />
          )}
        </BcfRenderer>
      </div>
      <aside
        className={
          drawerOpen ? `${styles.drawer} ${styles.open}` : styles.drawer
        }
        inert={!drawerOpen}
      >
        <Palette
          brush={brush}
          onAddToHotbar={(action) => {
            if (slotsLoaded) {
              dispatch({ type: 'add-to-hotbar', action });
            }
          }}
          onClose={() => setDrawerOpen(false)}
          onSelect={(action) => dispatch({ type: 'set-brush', brush: action })}
          searchRef={searchRef}
        />
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
          pulse={rejection !== null && !rejection.invalid ? rejection : null}
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
  cellSize: number;
  fill: Fill;
  resolver: BCFResolver;
  respectCooldowns: boolean;
};

function FillPreview({
  cellSize,
  fill,
  resolver,
  respectCooldowns,
}: FillPreviewProps) {
  const { action, actorId, endTick, startTick } = fill;
  const ticks = actionFillTicks(action, startTick, endTick, respectCooldowns);

  // Existing attacks between filled attack ticks that would be removed.
  const removed: number[] = [];
  if (action.type === 'attack') {
    const landing = new Set(ticks);
    const last = Math.max(startTick, endTick);
    for (let tick = Math.min(startTick, endTick); tick <= last; tick++) {
      const actions = resolver.getCell(actorId, tick)?.actions ?? [];
      if (!landing.has(tick) && actions.some((a) => a.type === 'attack')) {
        removed.push(tick);
      }
    }
  }

  return (
    <>
      <RegionOverlay
        className={styles.fillRegion}
        endRowId={actorId}
        endTick={endTick}
        startRowId={actorId}
        startTick={startTick}
      />
      {removed.map((tick) => (
        <CellOverlay
          className={styles.removed}
          key={tick}
          rowId={actorId}
          tick={tick}
        />
      ))}
      {ticks.map((tick) => (
        <CellOverlay
          className={`${styles.ghost} ${styles.valid}`}
          key={tick}
          rowId={actorId}
          tick={tick}
        >
          <ActionIcon action={action} size={cellSize - 2} />
        </CellOverlay>
      ))}
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

function describeHit(hit: HitTestResult | null): string | null {
  if (hit === null) {
    return null;
  }
  if (hit.type === 'tick-header') {
    return `tick header ${hit.tick}`;
  }
  return `cell ${hit.rowId}:${hit.tick} (row ${hit.rowIndex})`;
}
