'use client';

import {
  BCFAction,
  BCFResolver,
  BlertChartFormat,
  actorTypeSupportsAction,
} from '@blert/bcf';
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
  InteractionHandler,
} from '@/components/attack-timeline';
import Button from '@/components/button';
import { useModifierKey } from '@/hooks/modifier-key';
import { clamp } from '@/utils/math';

import { useActionDrag } from './action-drag';
import { cycleAttack } from './action-registry';
import { ActionIcon } from './action-icon';
import { placeAction, removeAction, removeCell } from './bcf-mutator';
import { CellBar } from './cell-bar';
import { MIN_CELL_SIZE, MAX_CELL_SIZE } from './constants';
import { CellCoord, currentDocument } from './editor-state';
import { Hotbar } from './hotbar';
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

function canPlace(
  resolver: BCFResolver,
  actorId: string,
  action: BCFAction,
): boolean {
  const actor = resolver.getActor(actorId);
  return (
    actor !== undefined && actorTypeSupportsAction(actor.type, action.type)
  );
}

export function ChartEditor() {
  const editor = useChartEditor(DEFAULT_CHART);
  const { state, slotsLoaded, dispatch, update } = editor;
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
  const { activeSlot, brush, focus, slots } = state;

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

  const interactionHandler = useMemo<InteractionHandler>(
    () => ({
      onPointerDown: (hit, e) => {
        if (e.button !== 0 || hit?.type !== 'cell') {
          return;
        }

        const cell = { actorId: hit.rowId, tick: hit.tick };
        if (e.altKey) {
          const actions =
            resolver.getCell(cell.actorId, cell.tick)?.actions ?? [];
          const picked = actions.find((a) => a.type === 'attack') ?? actions[0];
          if (picked !== undefined) {
            dispatch({ type: 'set-brush', brush: picked });
          }
          return;
        }

        if (brush === null) {
          dispatch({ type: 'set-focus', focus: cell });
        } else {
          place(cell, brush);
        }
      },
      onPointerMove: (hit) => {
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
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const modifier = e.ctrlKey || e.metaKey;

      switch (e.key) {
        case 'z':
        case 'Z':
          if (modifier) {
            e.preventDefault();
            dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
          }
          break;

        case 'y':
          if (modifier) {
            e.preventDefault();
            dispatch({ type: 'redo' });
          }
          break;

        case '-':
        case '=':
        case '+':
          if (modifier) {
            e.preventDefault();
            setCellSize((size) => size + (e.key == '-' ? -2 : 2));
          }
          break;

        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight':
          if (!modifier && !e.altKey) {
            e.preventDefault();
            dispatch({
              type: 'move-focus',
              rows: e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0,
              ticks:
                e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0,
            });
          }
          break;

        case 'Delete':
          if (
            focus !== null &&
            resolver.getCell(focus.actorId, focus.tick) !== undefined
          ) {
            e.preventDefault();
            update((doc) => removeCell(doc, focus.actorId, focus.tick));
          }
          break;

        case 'Backspace':
          if (focus === null) {
            return;
          }
          e.preventDefault();
          if (resolver.getCell(focus.actorId, focus.tick) !== undefined) {
            update((doc) => removeCell(doc, focus.actorId, focus.tick));
          }
          dispatch({ type: 'move-focus', rows: 0, ticks: -1 });
          break;

        case 'a':
        case 'A':
          if (!modifier && !e.altKey) {
            e.preventDefault();
            setDrawerOpen((open) => !open);
          }
          break;

        case 's':
        case 'S':
          if (!modifier && brush !== null) {
            const next = cycleAttack(brush, e.shiftKey ? -1 : 1);
            if (next !== null) {
              e.preventDefault();
              dispatch({ type: 'set-brush', brush: next });
            }
          }
          break;

        case '/':
          if (!modifier) {
            e.preventDefault();
            flushSync(() => setDrawerOpen(true));
            searchRef.current?.focus({ preventScroll: true });
          }
          break;

        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          if (!modifier && !e.altKey) {
            e.preventDefault();
            dispatch({ type: 'select-slot', slot: Number(e.key) - 1 });
          }
          break;

        case 'Escape':
          if (brush !== null || activeSlot !== null) {
            dispatch({ type: 'set-brush', brush: null });
          } else if (focus !== null) {
            dispatch({ type: 'set-focus', focus: null });
          }
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSlot, brush, dispatch, focus, resolver, setCellSize, update]);

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
          resolver={resolver}
          focus={focus}
          onRemoveAction={removeFocusedAction}
        />
      </div>
      <div className={styles.grid} ref={gridRef}>
        <BcfRenderer
          bcf={bcf}
          cellSize={cellSize}
          wrapWidth={wrapWidth}
          interactionHandler={interactionHandler}
          tooltipId="chart-editor"
        >
          {focus !== null && (
            <CellOverlay
              rowId={focus.actorId}
              tick={focus.tick}
              className={styles.focusOverlay}
              ref={focusRef}
            />
          )}
          <Ghost
            hover={hover}
            brush={drag?.action ?? brush}
            altHeld={altHeld}
            bcf={bcf}
            resolver={resolver}
            cellSize={cellSize}
          />
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
          slots={slots}
        />
      </div>
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
