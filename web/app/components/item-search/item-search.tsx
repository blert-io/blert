'use client';

import { EquipmentSlot } from '@blert/common';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ExtendedItemData,
  extendedItemCache,
} from '@/utils/item-cache/extended';

import SearchMenu, { ITEM_HEIGHT } from './search-menu';

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
  inputRef?: React.RefObject<HTMLInputElement>;
  /** Optional key to display in the input */
  displayKey?: string;
  /** Whether to show item IDs in the results */
  showIds?: boolean;
};

const INPUT_WIDTH = 320;

const enum State {
  CLOSED,
  OPEN_BELOW,
  OPEN_ABOVE,
}

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
  const [state, setState] = useState<State>(State.CLOSED);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const isOpen = state !== State.CLOSED;
  function setIsOpen(open: boolean) {
    if (open) {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) {
        const maxMenuHeight = ITEM_HEIGHT * maxResults;
        const isAbove = rect.top + maxMenuHeight > window.innerHeight;
        setState(isAbove ? State.OPEN_ABOVE : State.OPEN_BELOW);
      }
    } else {
      setState(State.CLOSED);
    }
  }

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

  const showMenu = isOpen && results.length > 0;

  let className = styles.itemSearch;
  if (showMenu) {
    className += ` ${state === State.OPEN_ABOVE ? styles.openAbove : styles.openBelow}`;
  }

  return (
    <div className={className} ref={wrapperRef} style={{ width: INPUT_WIDTH }}>
      <input
        autoComplete="off"
        id={id}
        className={styles.input}
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
      <SearchMenu
        attach={state === State.OPEN_ABOVE ? 'top' : 'bottom'}
        open={showMenu}
        onClose={handleClickOutside}
        results={results}
        onSelect={handleSelect}
        targetId={id}
        width={INPUT_WIDTH}
        showIds={showIds}
      />
    </div>
  );
}
