import { useContext } from 'react';

import Item from '@/components/item';
import { extendedItemCache } from '@/utils/item-cache/extended';

import { SetupEditingContext } from '../../editing-context';

import setupStyles from '../../style.module.scss';
import styles from './style.module.scss';

const MELEE_ITEMS = [
  28254, 28256, 28258, 22981, 13239, 21295, 29801, 28307, 11665, 24780, 22325,
  13652, 1215, 22322, 21003, 11804, 23987, 24219, 21015, 28997, 29084,
];
const RANGED_ITEMS = [
  11664, 13072, 13073, 8842, 13237, 28951, 19547, 28310, 27235, 27238, 27241,
  20997, 12926, 28922, 11959, 21000, 27610, 26374, 11212, 21944,
];
const MAGIC_ITEMS = [
  21018, 21021, 21024, 19544, 13235, 21791, 12002, 28313, 11663, 26241, 26243,
  26245, 21006, 24424, 28266, 22323, 27275, 27251,
];
const SUPPLY_ITEMS = [13441, 23685, 12695, 23733, 6685, 3024, 4417, 27641];
const UTILITY_ITEMS = [
  27281, 10588, 12018, 11090, 25975, 25818, 12612, 27544, 9763,
];
const RUNE_ITEMS = [
  554, 555, 556, 557, 558, 562, 560, 565, 21880, 559, 564, 561, 563, 566, 9075,
  4694, 4695, 4696, 4697, 4698, 4699, 28929,
];

const ITEM_SIZE = 28;

export function ItemSelector() {
  const context = useContext(SetupEditingContext);

  return (
    <div className={`${setupStyles.panel} ${styles.itemSelector}`}>
      <h2 className={styles.heading}>Items</h2>
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
                name={extendedItemCache.getItemName(id)}
                quantity={1}
                size={ITEM_SIZE}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
