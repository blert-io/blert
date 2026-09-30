'use client';

import {
  BCFAction,
  BCFResolver,
  BlertChartFormat,
  actorTypeSupportsAction,
} from '@blert/bcf';
import Image from 'next/image';
import {
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import BcfRenderer, {
  CellOverlay,
  InteractionHandler,
  getActionMetadata,
} from '@/components/attack-timeline';
import Button from '@/components/button';
import { clamp } from '@/utils/math';

import { placeAction, removeAction, removeCell } from './bcf-mutator';
import { CellBar } from './cell-bar';
import { MIN_CELL_SIZE, MAX_CELL_SIZE } from './constants';
import { CellCoord, currentDocument } from './editor-state';
import { Hotbar } from './hotbar';
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

const DEFAULT_BRUSH: BCFAction = { type: 'attack', attackType: 'SCYTHE' };

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
  const { state, dispatch, update } = editor;
  const [drawerOpen, setDrawerOpen] = useState(false);
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

  // TODO(frolv): remove once selection selects
  useEffect(() => {
    dispatch({ type: 'set-brush', brush: DEFAULT_BRUSH });
  }, [dispatch]);

  const bcf = currentDocument(state);
  const resolver = useMemo(() => new BCFResolver(bcf), [bcf]);
  const { brush, focus } = state;

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

  const [hover, setHover] = useState<CellCoord | null>(null);

  const interactionHandler = useMemo<InteractionHandler>(
    () => ({
      onPointerDown: (hit, e) => {
        if (e.button !== 0 || hit?.type !== 'cell') {
          return;
        }

        const cell = { actorId: hit.rowId, tick: hit.tick };
        if (brush === null) {
          dispatch({ type: 'set-focus', focus: cell });
        } else if (canPlace(resolver, cell.actorId, brush)) {
          update((doc) => placeAction(doc, cell.actorId, cell.tick, brush));
          dispatch({ type: 'set-focus', focus: cell });
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
      },
      cursor: (hit) => {
        if (hit?.type !== 'cell') {
          return undefined;
        }
        if (brush !== null && !canPlace(resolver, hit.rowId, brush)) {
          return 'not-allowed';
        }
        return 'cell';
      },
    }),
    [brush, dispatch, resolver, update],
  );

  const wrapWidth = gridWidth !== null && gridWidth > 0 ? gridWidth : undefined;

  const brushImage =
    brush !== null ? getActionMetadata(brush).imageUrl : undefined;

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

        case 'Escape':
          if (brush !== null) {
            dispatch({ type: 'set-brush', brush: null });
          } else if (focus !== null) {
            dispatch({ type: 'set-focus', focus: null });
          }
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [brush, dispatch, focus, resolver, setCellSize, update]);

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
            tooltip="Actions"
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
            />
          )}
          {brush !== null && hover !== null && (
            <CellOverlay
              rowId={hover.actorId}
              tick={hover.tick}
              className={
                canPlace(resolver, hover.actorId, brush)
                  ? `${styles.ghost} ${styles.valid}`
                  : `${styles.ghost} ${styles.invalid}`
              }
            >
              {brushImage !== undefined && (
                <Image
                  src={brushImage}
                  alt=""
                  width={cellSize - 2}
                  height={cellSize - 2}
                />
              )}
            </CellOverlay>
          )}
        </BcfRenderer>
      </div>
      <aside
        className={
          drawerOpen ? `${styles.drawer} ${styles.open}` : styles.drawer
        }
      />
      <div className={styles.hotbar}>
        <Hotbar
          brush={brush}
          onClearBrush={() => dispatch({ type: 'set-brush', brush: null })}
        />
      </div>
    </div>
  );
}
