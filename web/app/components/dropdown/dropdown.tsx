'use client';

import { ReactNode, useState } from 'react';

import Menu, { MenuItem } from '@/components/menu';

import styles from './style.module.scss';

/**
 * Class for the field to which a `Dropdown` attaches.
 * Used to join the element to the list while the list is open.
 */
export const DROPDOWN_FIELD = styles.field;

type DropdownProps = {
  /**
   * The field the list attaches to, such as a text input or a button. The
   * field must have the ID `targetId` and the class `DROPDOWN_FIELD`.
   */
  children: ReactNode;
  items: MenuItem[];
  onBrowse?: (item: MenuItem | null) => void;
  onClose?: () => void;
  onSelection?: (value: string | number) => void;
  open: boolean;
  targetId: string;
};

export default function Dropdown({
  children,
  items,
  onBrowse,
  onClose,
  onSelection,
  open,
  targetId,
}: DropdownProps) {
  const [edge, setEdge] = useState<'top' | 'bottom'>('bottom');

  let className = styles.dropdown;
  if (open && items.length > 0) {
    className += ` ${edge === 'top' ? styles.above : styles.below}`;
  }

  return (
    <div className={className}>
      {children}
      <Menu
        attach="bottom"
        itemClass={styles.row}
        items={items}
        menuClass={styles.list}
        onBrowse={onBrowse}
        onClose={onClose}
        onPlacement={setEdge}
        onSelection={onSelection}
        open={open}
        targetId={targetId}
      />
    </div>
  );
}
