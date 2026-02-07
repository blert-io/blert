'use client';

import { useRef, useState } from 'react';

import Input, { InputProps } from '@/components/input';
import Menu, { MenuItem } from '@/components/menu';
import { ticksFromTime, ticksToFormattedSeconds } from '@/utils/tick';

import { Comparator } from './comparator';

import styles from './style.module.scss';

type TickInputProps = Omit<
  InputProps,
  'horizontalPadding' | 'onChange' | 'placeholder' | 'type' | 'value'
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
      return 'fa-equals';
    case Comparator.LESS_THAN:
      return 'fa-less-than';
    case Comparator.GREATER_THAN:
      return 'fa-greater-than';
    case Comparator.LESS_THAN_OR_EQUAL:
      return 'fa-less-than-equal';
    case Comparator.GREATER_THAN_OR_EQUAL:
      return 'fa-greater-than-equal';
  }
}

const COMPARATOR_MENU_ITEMS: MenuItem[] = [
  { label: 'Equal to', secondary: '=', value: Comparator.EQUAL },
  { label: 'Less than', secondary: '<', value: Comparator.LESS_THAN },
  {
    label: 'At most',
    secondary: '\u2264',
    value: Comparator.LESS_THAN_OR_EQUAL,
  },
  { label: 'Greater than', secondary: '>', value: Comparator.GREATER_THAN },
  {
    label: 'At least',
    secondary: '\u2265',
    value: Comparator.GREATER_THAN_OR_EQUAL,
  },
];

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
  const [invalid, setInvalid] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const comparatorButtonId = `${props.id}-comparator`;

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

  function toggleTicks() {
    setDisplayTicks(!displayTicks);
    setValue(convertValue(value, !displayTicks));
    setInvalid(false);
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      toggleTicks();
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

  return (
    <div className={styles.tickInput}>
      <div className={styles.inputArea}>
        <Input
          {...props}
          errorMessage="Invalid time"
          horizontalPadding={props.comparator ? 36 : undefined}
          invalid={invalid}
          onBlur={onBlur}
          onChange={onChange}
          onKeyDown={onKeyDown}
          maxLength={displayTicks ? 6 : 10}
          placeholder={displayTicks ? undefined : '0:00.0'}
          ref={ref}
          value={value}
          type={displayTicks ? 'number' : 'text'}
        />
        {props.comparator && (
          <>
            <button
              className={styles.comparator}
              id={comparatorButtonId}
              onClick={() => setMenuOpen(!menuOpen)}
              type="button"
            >
              <i className={`fas ${comparatorIcon(comparator)}`} />
            </button>
            <Menu
              attach="bottom"
              items={COMPARATOR_MENU_ITEMS}
              onClose={() => setMenuOpen(false)}
              onSelection={(value) => {
                const newComparator = value as Comparator;
                setComparator(newComparator);
                callOnChange(undefined, newComparator);
              }}
              open={menuOpen}
              targetId={comparatorButtonId}
              width={170}
            />
          </>
        )}
      </div>
      <div className={styles.modeToggle}>
        <button
          className={!displayTicks ? styles.active : undefined}
          onClick={displayTicks ? toggleTicks : undefined}
          type="button"
        >
          Time
        </button>
        <button
          className={displayTicks ? styles.active : undefined}
          onClick={!displayTicks ? toggleTicks : undefined}
          type="button"
        >
          Ticks
        </button>
      </div>
    </div>
  );
}
