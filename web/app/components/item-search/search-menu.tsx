'use client';

import { ExtendedItemData } from '@/utils/item-cache/extended';

import Item from '../item';
import Menu from '../menu';

import styles from './style.module.scss';
import { useEffect, useState } from 'react';

type SearchMenuProps = {
  attach: 'bottom' | 'top';
  open: boolean;
  onClose: () => void;
  results: ExtendedItemData[];
  onSelect: (item: ExtendedItemData) => void;
  targetId: string;
  width?: number;
  showIds?: boolean;
};

export const ITEM_HEIGHT = 44;

export default function SearchMenu({
  attach,
  open,
  onClose,
  results,
  onSelect,
  targetId,
  width,
  showIds = false,
}: SearchMenuProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) {
      setPosition(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    const height = ITEM_HEIGHT * results.length;
    if (attach === 'top') {
      setPosition({ x: rect.left, y: rect.top - height });
    } else {
      setPosition({ x: rect.left, y: rect.top + rect.height });
    }
  }, [attach, results, open, targetId]);

  if (position === null) {
    return null;
  }

  const items = results.map((item) => ({
    label: item.name,
    customAction: () => onSelect(item),
    customElement: (
      <div className={styles.item}>
        <Item id={item.id} name={item.name} quantity={1} size={24} />
        <span className={styles.name}>{item.name}</span>
        {showIds && <span className={styles.id}>({item.id})</span>}
      </div>
    ),
  }));

  return (
    <Menu
      attach={attach}
      items={items}
      open={open}
      onClose={onClose}
      position={position}
      menuClass={styles.menu}
      width={width}
    />
  );
}
