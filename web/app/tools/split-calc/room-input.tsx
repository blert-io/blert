'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';

import TickInput from '@/components/tick-input';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';

import {
  RoomDefinition,
  SplitDistribution,
  RoomSource,
  RoomState,
} from './types';
import { formatPercentile, percentile } from './probability';

import styles from './style.module.scss';

type RoomInputProps = {
  room: RoomDefinition;
  state: RoomState;
  distribution: SplitDistribution | null;
  loading: boolean;
  infeasible: boolean;
  onTicksChange: (ticks: number | null) => void;
  onConfirm: (ticks: number | null) => void;
  onLockToggle: () => void;
};

function percentileClass(pct: number): string {
  if (pct <= 30) {
    return styles.rare;
  }
  if (pct <= 60) {
    return styles.average;
  }
  return styles.common;
}

function sourceClass(source: RoomSource): string {
  switch (source) {
    case 'computed':
      return styles.computed;
    case 'imported':
      return styles.imported;
    default:
      return '';
  }
}

export function RoomInput({
  room,
  state,
  distribution,
  loading,
  infeasible,
  onTicksChange,
  onConfirm,
  onLockToggle,
}: RoomInputProps) {
  const [editing, setEditing] = useState(false);
  const [hasValue, setHasValue] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const pct =
    state.ticks !== null && distribution !== null && distribution.total > 0
      ? percentile(distribution.bins, distribution.total, state.ticks)
      : null;

  const rowClasses = [
    styles.roomRow,
    sourceClass(state.source),
    infeasible ? styles.infeasible : '',
  ]
    .filter(Boolean)
    .join(' ');

  function handleChange(ticks: number | null) {
    setHasValue(ticks !== null);
    onTicksChange(ticks);
  }

  function handleConfirm(ticks: number | null) {
    setEditing(false);
    setHasValue(false);
    onConfirm(ticks);
  }

  function handleFocus() {
    setEditing(true);
  }

  function handleBlur(e: React.FocusEvent) {
    // Stay in editing mode if focus moves to another element within this row
    // (e.g. the time/ticks toggle buttons).
    if (wrapperRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }
    setEditing(false);
    setHasValue(false);
  }

  return (
    <div className={rowClasses} ref={wrapperRef} onBlur={handleBlur}>
      <div className={styles.roomImageContainer}>
        <Image
          src={room.image}
          alt={room.label}
          width={40}
          height={40}
          className={styles.roomImage}
        />
        {state.source === 'computed' && (
          <span className={styles.computedLabel}>COMPUTED</span>
        )}
      </div>
      <div className={styles.roomInput}>
        <div className={styles.inputWrapper}>
          <TickInput
            id={`room-${room.key}`}
            inputMode="time"
            label={room.label}
            adjustStep={room.tickCycle}
            round={room.tickCycle}
            ticks={editing ? undefined : state.ticks}
            onChange={handleChange}
            onConfirm={handleConfirm}
            onFocus={handleFocus}
          />
          {editing && hasValue && (
            <kbd className={styles.enterHint}>&#x23CE;</kbd>
          )}
        </div>
      </div>
      <div className={styles.roomControls}>
        {loading ? (
          <span className={`${styles.percentileBadge} ${styles.empty}`}>
            &ndash;
          </span>
        ) : pct !== null ? (
          <span
            className={`${styles.percentileBadge} ${percentileClass(pct)}`}
            data-tooltip-id={GLOBAL_TOOLTIP_ID}
            data-tooltip-content={`${formatPercentile(pct)} of recorded splits are faster than this`}
          >
            {formatPercentile(pct)}
          </span>
        ) : (
          <span className={`${styles.percentileBadge} ${styles.empty}`}>
            &ndash;
          </span>
        )}
        <button
          className={`${styles.lockButton} ${state.locked ? styles.locked : ''}`}
          onClick={onLockToggle}
          type="button"
          data-tooltip-id={GLOBAL_TOOLTIP_ID}
          data-tooltip-content={state.locked ? 'Unlock room' : 'Lock room'}
        >
          <i className={`fas ${state.locked ? 'fa-lock' : 'fa-lock-open'}`} />
        </button>
      </div>
    </div>
  );
}
