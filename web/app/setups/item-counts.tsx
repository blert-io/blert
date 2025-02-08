'use client';

import { useContext } from 'react';

import Item from '@/components/item';
import { extendedItemCache } from '@/utils/item-cache/extended';

import { GearSetup, getContainer, Container } from './setup';
import { SetupViewingContext } from './viewing-context';

import styles from './style.module.scss';

interface ItemCountsProps {
  setup: GearSetup;
  selectedItemId?: number;
}

export default function ItemCounts({ setup, selectedItemId }: ItemCountsProps) {
  const { setHighlightedItemId } = useContext(SetupViewingContext);

  const counts = new Map<number, number>();

  for (const player of setup.players) {
    for (const container of [
      Container.INVENTORY,
      Container.EQUIPMENT,
      Container.POUCH,
    ]) {
      const slots = getContainer(player, container);

      for (const slot of slots) {
        if (slot.item !== null) {
          const currentCount = counts.get(slot.item.id) ?? 0;
          counts.set(slot.item.id, currentCount + slot.item.quantity);
        }
      }
    }
  }

  // Sort items by ID.
  const itemCounts = Array.from(counts.entries());
  itemCounts.sort((a, b) => a[0] - b[0]);

  return (
    <div className={`${styles.panel} ${styles.itemCounts}`}>
      <h3>Required Items</h3>
      <div className={styles.items}>
        {itemCounts.length > 0 ? (
          itemCounts.map(([id, quantity]) => (
            <div
              key={id}
              className={`${styles.itemCount} ${id === selectedItemId ? styles.highlighted : ''}`}
              onMouseEnter={() => setHighlightedItemId(id)}
              onMouseLeave={() => setHighlightedItemId(null)}
            >
              <Item
                name={extendedItemCache.getItemName(id)}
                quantity={1}
                size={30}
              />
              <span className={styles.quantity}>×{quantity}</span>
            </div>
          ))
        ) : (
          <div className={styles.noItems}>No items in setup.</div>
        )}
      </div>
    </div>
  );
}
