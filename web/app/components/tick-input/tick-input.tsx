'use client';

import { useRef, useState } from 'react';

import Input, { InputProps } from '@/components/input';
import { ticksFromTime, ticksToFormattedSeconds } from '@/utils/tick';

import { Comparator } from './comparator';

import styles from './style.module.scss';

type TickInputProps = Omit<
  InputProps,
  'horizontalPadding' | 'onChange' | 'type' | 'value'
> & {
  comparator?: boolean;
  initialTicks?: number;
  initialComparator?: Comparator;
  onChange?: (ticks: number | null, comparator?: Comparator) => void;
  round?: number;
};

function comparatorIcon(comparator: Comparator): string {
  switch (comparator) {
    case Comparator.EQUAL:
      return 'equals';
    case Comparator.LESS_THAN:
      return 'less-than';
    case Comparator.GREATER_THAN:
      return 'greater-than';
    case Comparator.LESS_THAN_OR_EQUAL:
      return 'less-than-equal';
    case Comparator.GREATER_THAN_OR_EQUAL:
      return 'greater-than-equal';
  }
}

function normalizeTimeString(time: string): string {
  if (time === ':') {
    return '0:00';
  }

  if (time.endsWith(':') || time.endsWith('.')) {
    time += '00';
  }

  if (!time.includes(':')) {
    const [secs, rest] = time.split('.');
    const seconds = Number(secs);
    const minutes = Math.floor(seconds / 60);

    let result = `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
    if (rest) {
      result += `.${rest}`;
    }
    return result;
  }
  return time;
}

function convertValue(value: string, toTicks: boolean): string {
  if (value === '') {
    return value;
  }
  if (toTicks) {
    const ticks = ticksFromTime(normalizeTimeString(value));
    return ticks !== null ? ticks.toString() : '';
  }
  const ticks = Number.parseInt(value);
  return ticksToFormattedSeconds(ticks);
}

export default function TickInput(props: TickInputProps) {
  const [displayTicks, setDisplayTicks] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() =>
    props.initialTicks !== undefined
      ? ticksToFormattedSeconds(props.initialTicks)
      : '',
  );
  const [comparator, setComparator] = useState<Comparator>(
    props.initialComparator ?? Comparator.EQUAL,
  );

  function callOnChange(val?: string, cmp?: Comparator) {
    const v = val ?? value;
    let ticks =
      v === ''
        ? null
        : displayTicks
          ? Number(v)
          : ticksFromTime(normalizeTimeString(v));
    if (ticks !== null && props.round) {
      ticks = Math.ceil(ticks / props.round) * props.round;
    }
    const c = cmp ?? comparator;
    props.onChange?.(ticks, props.comparator ? c : undefined);
  }

  const cycleComparator = () => {
    const newComparator =
      comparator === Comparator.EQUAL
        ? Comparator.LESS_THAN
        : comparator === Comparator.LESS_THAN
          ? Comparator.GREATER_THAN
          : Comparator.EQUAL;
    setComparator(newComparator);
    callOnChange(undefined, newComparator);
  };

  function toggleTicks() {
    setDisplayTicks(!displayTicks);
    setValue(convertValue(value, !displayTicks));
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      toggleTicks();
    }
    props.onKeyDown?.(e);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (/^[0-9:.]*$/.test(e.target.value)) {
      setValue(e.target.value);
      callOnChange(e.target.value);
    }
  };

  const onBlur = () => {
    if (!displayTicks && value !== '') {
      let ticks = ticksFromTime(normalizeTimeString(value));
      if (ticks !== null && props.round) {
        ticks = Math.ceil(ticks / props.round) * props.round;
      }
      const formatted = ticks !== null ? ticksToFormattedSeconds(ticks) : '';
      if (formatted !== value) {
        setValue(formatted);
        props.onChange?.(ticks, props.comparator ? comparator : undefined);
      }
    }
  };

  return (
    <div className={styles.tickInput}>
      <Input
        {...props}
        horizontalPadding={props.comparator ? 36 : undefined}
        onBlur={onBlur}
        onChange={onChange}
        onKeyDown={onKeyDown}
        maxLength={displayTicks ? 6 : 10}
        ref={ref}
        value={value}
        type={displayTicks ? 'number' : 'text'}
      />
      <div className={styles.typeBar}>
        <button disabled={!displayTicks} onClick={toggleTicks} type="button">
          <i className="far fa-clock" />
        </button>
        <button disabled={displayTicks} onClick={toggleTicks} type="button">
          <i className="fas fa-stopwatch" />
        </button>
      </div>
      {props.comparator && (
        <button
          className={styles.comparator}
          onClick={cycleComparator}
          type="button"
        >
          <i className={`fas fa-${comparatorIcon(comparator)}`} />
        </button>
      )}
    </div>
  );
}
