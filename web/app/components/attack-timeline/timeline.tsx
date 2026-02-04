'use client';

import { BCFResolver } from '@blert/bcf';
import { useContext } from 'react';

import { Cell } from './cell';
import { ActionEvaluator, RenderContext } from './types';

import styles from './bcf-renderer.module.scss';

type ColumnProps = {
  resolver: BCFResolver;
  rowOrder: string[];
  tick: number;
  onTickSelect?: (tick: number) => void;
  actionEvaluator?: ActionEvaluator;
};

export function Column({
  resolver,
  rowOrder,
  tick,
  onTickSelect,
  actionEvaluator,
}: ColumnProps) {
  const { display } = useContext(RenderContext);
  const splitName = display?.getSplitNameAt(tick);

  let tickHeader;
  if (onTickSelect !== undefined) {
    tickHeader = (
      <button
        className={`${styles.columnTick} ${styles.interactive}`}
        onClick={() => onTickSelect(tick)}
      >
        {tick}
      </button>
    );
  } else {
    tickHeader = <div className={styles.columnTick}>{tick}</div>;
  }

  return (
    <div className={styles.column}>
      {splitName !== undefined && (
        <div className={styles.split}>
          <span className={styles.splitName}>{splitName}</span>
          <div className={styles.splitIndicator}>
            <div className={styles.splitLine} />
            <div className={styles.splitTail} />
          </div>
        </div>
      )}
      {tickHeader}
      {rowOrder.map((rowId) => (
        <Cell
          key={rowId}
          resolver={resolver}
          rowId={rowId}
          tick={tick}
          actionEvaluator={actionEvaluator}
        />
      ))}
      {splitName !== undefined && (
        <div className={`${styles.split} ${styles.splitBottom}`}>
          <div className={styles.splitIndicator}>
            <div className={styles.splitLine} />
          </div>
        </div>
      )}
    </div>
  );
}

type CoreTimelineRendererProps = {
  resolver: BCFResolver;
  rowOrder: string[];
  numRows: number;
  ticksPerRow: number;
  onTickSelect?: (tick: number) => void;
  actionEvaluator?: ActionEvaluator;
};

export function CoreTimelineRenderer({
  resolver,
  rowOrder,
  numRows,
  ticksPerRow,
  onTickSelect,
  actionEvaluator,
}: CoreTimelineRendererProps) {
  const rowElements: React.ReactNode[] = [];

  for (let row = 0; row < numRows; row++) {
    const rowStartTick = resolver.startTick + row * ticksPerRow;
    if (rowStartTick > resolver.endTick) {
      break;
    }

    const columnElements: React.ReactNode[] = [];

    for (let i = 0; i < ticksPerRow; i++) {
      const tick = rowStartTick + i;
      if (tick > resolver.endTick) {
        break;
      }

      columnElements.push(
        <Column
          key={`column-${i}`}
          resolver={resolver}
          rowOrder={rowOrder}
          tick={tick}
          onTickSelect={onTickSelect}
          actionEvaluator={actionEvaluator}
        />,
      );
    }

    rowElements.push(
      <div key={`row-${row}`} className={styles.row}>
        {columnElements}
      </div>,
    );
  }

  return <>{rowElements}</>;
}
