'use client';

import { EquipmentSlot } from '@blert/common';
import { useCallback, useEffect, useState } from 'react';

import Dropdown, { DROPDOWN_FIELD } from '@/components/dropdown';
import Item from '@/components/item';
import { MenuItem } from '@/components/menu';
import {
  ExtendedItemData,
  extendedItemCache,
} from '@/utils/item-cache/extended';

import styles from './style.module.scss';

export type ItemSearchInputProps = {
  /** HTML ID for the input element. */
  id: string;
  /** Optional equipment slot to filter results by */
  slot?: EquipmentSlot;
  /** Optional predicate to filter results by */
  predicate?: (item: ExtendedItemData) => boolean;
  /** Maximum number of results to show */
  maxResults?: number;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Callback when an item is selected */
  onSelect?: (item: ExtendedItemData) => void;
  /** Callback when the input is cleared */
  onClear?: () => void;
  /** Optional ref for the input element */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Optional key to display in the input */
  displayKey?: string;
  /** Whether to show item IDs in the results */
  showIds?: boolean;
};

const INPUT_WIDTH = 320;

export default function ItemSearchInput({
  id,
  slot,
  maxResults = 10,
  disabled = false,
  placeholder = 'Search for an item…',
  onSelect,
  onClear,
  inputRef,
  predicate,
  displayKey,
  showIds = false,
}: ItemSearchInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ExtendedItemData[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const search = useCallback(
    (value: string) => {
      const searchResults = extendedItemCache.search(
        value,
        slot,
        maxResults,
        predicate,
      );
      setResults(searchResults);
    },
    [slot, maxResults, predicate],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    search(value);
    setIsOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setQuery('');
      setResults([]);
      setIsOpen(false);
      onClear?.();
    }
  };

  const handleSelect = (item: ExtendedItemData) => {
    onSelect?.(item);
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  const handleClickOutside = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleFocus = useCallback(() => {
    setIsOpen(true);
  }, []);

  useEffect(() => {
    if (query === '') {
      setResults([]);
      setIsOpen(false);
    }
  }, [query]);

  const items: MenuItem[] = results.map((item) => ({
    label: item.name,
    customAction: () => handleSelect(item),
    customElement: (
      <div className={styles.item}>
        <Item id={item.id} name={item.name} quantity={1} size={24} fitContent />
        <span className={styles.name}>{item.name}</span>
        {showIds && <span className={styles.id}>({item.id})</span>}
      </div>
    ),
  }));

  return (
    <div className={styles.itemSearch} style={{ width: INPUT_WIDTH }}>
      <Dropdown
        items={items}
        onClose={handleClickOutside}
        open={isOpen && results.length > 0}
        targetId={id}
      >
        <input
          autoComplete="off"
          id={id}
          className={DROPDOWN_FIELD}
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder={placeholder}
          disabled={disabled}
          style={{ width: INPUT_WIDTH }}
        />
        {displayKey && <span className={styles.key}>{displayKey}</span>}
      </Dropdown>
    </div>
  );
}
