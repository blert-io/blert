'use client';

import { forwardRef, useState } from 'react';

import Input, { InputProps } from '@/components/input';
import Menu, { MenuItem } from '@/components/menu';

import { Comparator } from './comparator';

import styles from './style.module.scss';

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

const COMPARATOR_PADDING = 36;

type ComparableInputProps = Omit<InputProps, 'horizontalPadding'> & {
  comparator: Comparator;
  onComparatorChange: (comparator: Comparator) => void;
};

const ComparableInput = forwardRef<HTMLInputElement, ComparableInputProps>(
  function ComparableInput(
    { comparator, onComparatorChange, ...inputProps },
    ref,
  ) {
    const [menuOpen, setMenuOpen] = useState(false);
    const comparatorButtonId = `${inputProps.id}-comparator`;

    return (
      <div className={styles.comparableInput}>
        <Input
          {...inputProps}
          horizontalPadding={COMPARATOR_PADDING}
          ref={ref}
        />
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
          onSelection={(v) => onComparatorChange(v as Comparator)}
          open={menuOpen}
          targetId={comparatorButtonId}
          width={170}
        />
      </div>
    );
  },
);

export default ComparableInput;
