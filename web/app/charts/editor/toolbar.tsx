'use client';

import { useState } from 'react';

import Button from '@/components/button';
import { useIsApple } from '@/display';

import { setTotalTicks, updateMeta } from './bcf-mutator';
import { MAX_CELL_SIZE, MAX_TICKS, MIN_CELL_SIZE } from './constants';
import { currentDocument } from './editor-state';
import { ChartEditor } from './use-chart-editor';

import styles from './toolbar.module.scss';

type ToolbarProps = {
  editor: ChartEditor;
  cellSize: number;
  onCellSizeChange: (cellSize: number) => void;
  children?: React.ReactNode;
};

export function Toolbar({
  editor,
  cellSize,
  onCellSizeChange,
  children,
}: ToolbarProps) {
  const { state, dispatch, update } = editor;
  const bcf = currentDocument(state);
  const isApple = useIsApple();

  const startTick = bcf.config.startTick ?? 0;
  const ticks = bcf.config.totalTicks - startTick;

  return (
    <>
      <input
        aria-label="Chart name"
        className={`${styles.field} ${styles.name}`}
        maxLength={128}
        placeholder="Chart name"
        type="text"
        value={bcf.name ?? ''}
        onChange={(e) => {
          const name = e.target.value;
          update(
            (doc) => updateMeta(doc, { name: name === '' ? null : name }),
            'name',
          );
        }}
      />
      <label className={styles.ticks}>
        Ticks
        <TickCountInput
          key={ticks}
          ticks={ticks}
          onCommit={(value) =>
            update((doc) => setTotalTicks(doc, startTick + value))
          }
        />
      </label>
      <label className={styles.cellSize}>
        <i className="fa-solid fa-magnifying-glass-plus" />
        <input
          type="range"
          min={MIN_CELL_SIZE}
          max={MAX_CELL_SIZE}
          value={cellSize}
          onChange={(e) => onCellSizeChange(Number(e.target.value))}
        />
        <span className={styles.readout}>{cellSize}px</span>
      </label>
      <span className={styles.spacer} />
      <Button
        disabled={state.position === 0}
        icon
        onClick={() => dispatch({ type: 'undo' })}
        toolbar
        tooltip={`Undo (${isApple ? '⌘Z' : 'Ctrl+Z'})`}
      >
        <i className="fa-solid fa-arrow-rotate-left" />
        <span className="sr-only">Undo</span>
      </Button>
      <Button
        disabled={state.position === state.history.length - 1}
        icon
        onClick={() => dispatch({ type: 'redo' })}
        toolbar
        tooltip={`Redo (${isApple ? '⌘⇧Z' : 'Ctrl+Y'})`}
      >
        <i className="fa-solid fa-arrow-rotate-right" />
        <span className="sr-only">Redo</span>
      </Button>
      {children}
    </>
  );
}

type TickCountInputProps = {
  ticks: number;
  onCommit: (ticks: number) => void;
};

function TickCountInput({ ticks, onCommit }: TickCountInputProps) {
  const [text, setText] = useState(String(ticks));

  const commit = () => {
    const value = Number(text);
    if (!Number.isInteger(value) || value < 1 || value > MAX_TICKS) {
      setText(String(ticks));
    } else if (value !== ticks) {
      onCommit(value);
    }
  };

  return (
    <input
      className={styles.field}
      min={1}
      max={MAX_TICKS}
      type="number"
      value={text}
      onBlur={commit}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
    />
  );
}
