'use client';

import { useEffect, useRef, useState } from 'react';

import ComparableInput, { Comparator } from '@/components/comparable-input';
import Input, { InputProps } from '@/components/input';
import { ticksFromTime, ticksToFormattedSeconds } from '@/utils/tick';

import styles from './style.module.scss';

type TickInputProps = Omit<
  InputProps,
  'horizontalPadding' | 'onChange' | 'placeholder' | 'type' | 'value'
> & {
  comparator?: boolean;
  initialTicks?: number;
  /** Controlled ticks prop. Syncs the displayed value only when not focused. */
  ticks?: number | null;
  initialComparator?: Comparator;
  onChange?: (ticks: number | null, comparator?: Comparator) => void;
  /** Large tick adjustment step for +/- buttons. Defaults to 5. */
  adjustStep?: number;
  /** Lock input to 'time' or 'ticks' mode. Omit to allow toggling. */
  inputMode?: 'time' | 'ticks';
  /** Called when the user presses Enter to confirm the current value. */
  onConfirm?: (ticks: number | null) => void;
  /** Round time-mode input up to a tick multiple; tick-mode values are untouched. */
  round?: number;
};

function normalizeTimeString(time: string): string {
  if (time === ':') {
    return '0:00';
  }

  if (time.endsWith(':') || time.endsWith('.')) {
    time += '00';
  }

  if (!time.includes(':')) {
    const [whole, rest] = time.split('.');
    const minutes = whole.length > 2 ? Number(whole.slice(0, -2)) : 0;
    const seconds = whole.length > 2 ? whole.slice(-2) : whole.padStart(2, '0');

    let result = `${minutes}:${seconds}`;
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

const DEFAULT_ADJUST_STEP = 5;

function adjustSteps(step: number, round?: number): number[] {
  const small = round ?? 1;
  if (small >= step) {
    return [-step, step];
  }
  return [-step, -small, small, step];
}

export default function TickInput(props: TickInputProps) {
  const lockedMode = props.inputMode;
  const [displayTicks, setDisplayTicks] = useState(lockedMode === 'ticks');
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() =>
    props.initialTicks !== undefined
      ? ticksToFormattedSeconds(props.initialTicks)
      : '',
  );
  const [comparator, setComparator] = useState<Comparator>(
    props.initialComparator ?? Comparator.EQUAL,
  );
  const [invalid, setInvalid] = useState(false);

  // Sync internal value when controlled `ticks` prop changes externally.
  // The parent is responsible for not updating `ticks` while the user is
  // actively editing (e.g. by tracking focus state).
  useEffect(() => {
    if (props.ticks === undefined) {
      return;
    }
    const newValue =
      props.ticks !== null
        ? displayTicks
          ? props.ticks.toString()
          : ticksToFormattedSeconds(props.ticks)
        : '';
    if (newValue !== value) {
      setValue(newValue);
      setInvalid(false);
    }
    // Only react to external ticks changes, not internal state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.ticks]);

  function callOnChange(val?: string, cmp?: Comparator) {
    const v = val ?? value;
    let ticks =
      v === ''
        ? null
        : displayTicks
          ? Number(v)
          : ticksFromTime(normalizeTimeString(v));
    if (ticks !== null && props.round && !displayTicks) {
      ticks = Math.ceil(ticks / props.round) * props.round;
    }
    const c = cmp ?? comparator;
    props.onChange?.(ticks, props.comparator ? c : undefined);
  }

  function toggleTicks() {
    setDisplayTicks(!displayTicks);
    setValue(convertValue(value, !displayTicks));
    setInvalid(false);
  }

  function currentTicks(): number | null {
    if (value === '') {
      return null;
    }
    if (displayTicks) {
      const n = Number(value);
      return isNaN(n) ? null : n;
    }
    return ticksFromTime(normalizeTimeString(value));
  }

  function handleAdjust(delta: number) {
    const ticks = currentTicks();
    if (ticks === null) {
      return;
    }
    const adjusted = Math.max(0, ticks + delta);
    const newValue = displayTicks
      ? adjusted.toString()
      : ticksToFormattedSeconds(adjusted);
    setValue(newValue);
    setInvalid(false);
    props.onChange?.(adjusted, props.comparator ? comparator : undefined);
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 't' || e.key === 'T') && lockedMode === undefined) {
      e.preventDefault();
      toggleTicks();
    } else if (e.key === 'Enter' && props.onConfirm) {
      e.preventDefault();
      let ticks =
        value === ''
          ? null
          : displayTicks
            ? Number(value)
            : ticksFromTime(normalizeTimeString(value));
      if (ticks !== null && props.round && !displayTicks) {
        ticks = Math.ceil(ticks / props.round) * props.round;
      }
      props.onConfirm(ticks);
    }
    props.onKeyDown?.(e);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (/^[0-9:.]*$/.test(e.target.value)) {
      setValue(e.target.value);
      setInvalid(false);
      callOnChange(e.target.value);
    }
  };

  const onBlur = () => {
    if (value === '') {
      setInvalid(false);
      return;
    }

    if (!displayTicks) {
      let ticks = ticksFromTime(normalizeTimeString(value));
      if (ticks === null) {
        setInvalid(true);
        return;
      }
      setInvalid(false);
      if (props.round) {
        ticks = Math.ceil(ticks / props.round) * props.round;
      }
      const formatted = ticksToFormattedSeconds(ticks);
      if (formatted !== value) {
        setValue(formatted);
        props.onChange?.(ticks, props.comparator ? comparator : undefined);
      }
    }
  };

  const inputProps: InputProps = {
    ...props,
    errorMessage: 'Invalid time',
    invalid,
    onBlur,
    onChange,
    onKeyDown,
    maxLength: displayTicks ? 6 : 10,
    placeholder: displayTicks ? undefined : '0:00.0',
    value,
    type: displayTicks ? 'number' : 'text',
  };

  return (
    <div className={styles.tickInput}>
      <div className={styles.inputArea}>
        {props.comparator ? (
          <ComparableInput
            {...inputProps}
            comparator={comparator}
            onComparatorChange={(c) => {
              setComparator(c);
              callOnChange(undefined, c);
            }}
            ref={ref}
          />
        ) : (
          <Input {...inputProps} ref={ref} />
        )}
      </div>
      <div className={styles.bottomBar}>
        {adjustSteps(props.adjustStep ?? DEFAULT_ADJUST_STEP, props.round).map(
          (delta) => (
            <button
              key={delta}
              disabled={currentTicks() === null}
              onClick={() => handleAdjust(delta)}
              type="button"
            >
              {delta > 0 ? `+${delta}t` : `${delta}t`}
            </button>
          ),
        )}
        {lockedMode !== 'ticks' && (
          <button
            className={`${styles.modeButton} ${!displayTicks ? styles.active : ''}`}
            onClick={displayTicks ? toggleTicks : undefined}
            type="button"
          >
            Time
          </button>
        )}
        {lockedMode !== 'time' && (
          <button
            className={`${styles.modeButton} ${displayTicks ? styles.active : ''}`}
            onClick={!displayTicks ? toggleTicks : undefined}
            type="button"
          >
            Ticks
          </button>
        )}
      </div>
    </div>
  );
}
