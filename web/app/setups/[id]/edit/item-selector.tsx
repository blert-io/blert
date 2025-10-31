'use client';

import { useContext, useEffect, useRef } from 'react';

import Item from '@/components/item';
import ItemSearchInput from '@/components/item-search';
import { extendedItemCache } from '@/utils/item-cache/extended';

import { SetupEditingContext } from '../../editing-context';

import setupStyles from '../../style.module.scss';
import styles from './style.module.scss';

const MELEE_ITEMS = [
  30750, 30753, 30756, 28254, 28256, 28258, 22981, 31097, 21295, 29801, 28307,
  11665, 24780, 22325, 13652, 1215, 26219, 27690, 22322, 21003, 11804, 11806,
  23987, 24219, 21015, 28997, 29084,
];
const RANGED_ITEMS = [
  11664, 13072, 13073, 8842, 31097, 28955, 19547, 28310, 27235, 27238, 27241,
  26235, 20997, 12926, 28922, 11959, 21000, 27610, 26374, 11212, 21944,
];
const MAGIC_ITEMS = [
  21018, 21021, 21024, 19544, 31097, 21791, 12002, 28313, 11663, 26241, 26243,
  26245, 21006, 24424, 28266, 31113, 22323, 27275, 27251,
];
const SUPPLY_ITEMS = [
  13441, 23685, 12695, 23733, 2444, 30875, 6685, 3024, 10925, 30125, 4417,
];
const UTILITY_ITEMS = [
  27281, 27641, 25975, 10588, 12018, 11090, 25818, 12612, 9763, 30759, 27544,
];
export const RUNE_ITEMS = [
  554, 555, 556, 557, 558, 562, 560, 565, 21880, 559, 564, 561, 563, 566, 9075,
  4694, 4695, 4696, 4697, 4698, 4699, 28929, 30843,
];

const ITEM_SIZE = 28;

export function ItemSelector() {
  const context = useContext(SetupEditingContext);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;
      if (!isInput && e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className={`${setupStyles.panel} ${styles.itemSelector}`}>
      <h2 className={styles.heading}>Choose an item</h2>
      <div className={styles.selectedItem}>
        {context?.selectedItem ? (
          <>
            <div className={styles.item}>
              <Item
                id={context.selectedItem.id}
                name={context.selectedItem.name}
                quantity={1}
                size={ITEM_SIZE}
              />
              <span className={styles.name}>{context.selectedItem.name}</span>
            </div>
            <button
              className={styles.clear}
              onClick={() => context.setSelectedItem(null)}
              title="Clear selection"
            >
              <i className="fas fa-times" />
              <span className="sr-only">Clear selection</span>
            </button>
          </>
        ) : (
          <div className={styles.placeholder}>No item selected</div>
        )}
      </div>
      <div className={styles.search}>
        <ItemSearchInput
          inputRef={searchRef}
          id="selector-item-search"
          displayKey="/"
          onSelect={(item) => context?.setSelectedItem(item.id)}
          onClear={() => {
            context?.setSelectedItem(null);
            searchRef.current?.blur();
          }}
          showIds
        />
      </div>
      <div className={styles.categories}>
        <h3 className={styles.sectionHeading}>Melee</h3>
        <div className={styles.section}>
          {MELEE_ITEMS.map((id) => {
            const isSelected = context?.selectedItem?.id === id;

            return (
              <button
                className={`${styles.item} ${isSelected ? styles.selected : ''}`}
                key={id}
                onClick={() => context?.setSelectedItem(isSelected ? null : id)}
              >
                <Item
                  id={id}
                  name={extendedItemCache.getItemName(id)}
                  quantity={1}
                  size={ITEM_SIZE}
                />
              </button>
            );
          })}
        </div>

        <h3 className={styles.sectionHeading}>Ranged</h3>
        <div className={styles.section}>
          {RANGED_ITEMS.map((id) => {
            const isSelected = context?.selectedItem?.id === id;

            return (
              <button
                className={`${styles.item} ${isSelected ? styles.selected : ''}`}
                key={id}
                onClick={() => context?.setSelectedItem(isSelected ? null : id)}
              >
                <Item
                  id={id}
                  name={extendedItemCache.getItemName(id)}
                  quantity={1}
                  size={ITEM_SIZE}
                />
              </button>
            );
          })}
        </div>

        <h3 className={styles.sectionHeading}>Magic</h3>
        <div className={styles.section}>
          {MAGIC_ITEMS.map((id) => {
            const isSelected = context?.selectedItem?.id === id;

            return (
              <button
                className={`${styles.item} ${isSelected ? styles.selected : ''}`}
                key={id}
                onClick={() => context?.setSelectedItem(isSelected ? null : id)}
              >
                <Item
                  id={id}
                  name={extendedItemCache.getItemName(id)}
                  quantity={1}
                  size={ITEM_SIZE}
                />
              </button>
            );
          })}
        </div>

        <h3 className={styles.sectionHeading}>Supplies</h3>
        <div className={styles.section}>
          {SUPPLY_ITEMS.map((id) => {
            const isSelected = context?.selectedItem?.id === id;

            return (
              <button
                className={`${styles.item} ${isSelected ? styles.selected : ''}`}
                key={id}
                onClick={() => context?.setSelectedItem(isSelected ? null : id)}
              >
                <Item
                  id={id}
                  name={extendedItemCache.getItemName(id)}
                  quantity={1}
                  size={ITEM_SIZE}
                />
              </button>
            );
          })}
        </div>

        <h3 className={styles.sectionHeading}>Utility</h3>
        <div className={styles.section}>
          {UTILITY_ITEMS.map((id) => {
            const isSelected = context?.selectedItem?.id === id;

            return (
              <button
                className={`${styles.item} ${isSelected ? styles.selected : ''}`}
                key={id}
                onClick={() => context?.setSelectedItem(isSelected ? null : id)}
              >
                <Item
                  id={id}
                  name={extendedItemCache.getItemName(id)}
                  quantity={1}
                  size={ITEM_SIZE}
                />
              </button>
            );
          })}
        </div>

        <h3 className={styles.sectionHeading}>Runes</h3>
        <div className={styles.section}>
          {RUNE_ITEMS.map((id) => {
            const isSelected = context?.selectedItem?.id === id;

            return (
              <button
                className={`${styles.item} ${isSelected ? styles.selected : ''}`}
                key={id}
                onClick={() => context?.setSelectedItem(isSelected ? null : id)}
              >
                <Item
                  id={id}
                  name={extendedItemCache.getItemName(id)}
                  quantity={1}
                  size={ITEM_SIZE}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
