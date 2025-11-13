'use client';

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { CustomItems, ItemCategory } from '@/actions/setup';
import Item from '@/components/item';
import ItemSearchInput from '@/components/item-search';
import { useToast } from '@/components/toast';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import {
  extendedItemCache,
  ExtendedItemData,
} from '@/utils/item-cache/extended';

import { useCustomItems } from './custom-items';
import { EditingContext, SetupEditingContext } from '../../editing-context';

import setupStyles from '../../style.module.scss';
import styles from './style.module.scss';

const DEFAULT_ITEMS: Record<ItemCategory, number[]> = {
  melee: [
    30750, 30753, 30756, 28254, 28256, 28258, 22981, 31097, 21295, 29801, 28307,
    11665, 24780, 22325, 13652, 29577, 1215, 26219, 27690, 22322, 21003, 11804,
    11806, 23987, 24219, 21015, 28997, 29084,
  ],
  ranged: [
    11664, 13072, 13073, 8842, 31097, 28955, 19547, 28310, 27235, 27238, 27241,
    26235, 20997, 12926, 28922, 11959, 21000, 27610, 26374, 11212, 21944,
  ],
  magic: [
    21018, 21021, 21024, 31106, 31097, 21791, 12002, 28313, 11663, 26241, 26243,
    26245, 21006, 24424, 28266, 31113, 22323, 27275, 27251,
  ],
  supplies: [
    13441, 23685, 12695, 23733, 2444, 30875, 6685, 3024, 10925, 30125, 4417,
  ],
  utility: [
    27281, 27641, 25975, 10588, 12018, 11090, 25818, 12612, 9763, 30759, 27544,
  ],
  runes: [
    554, 555, 556, 557, 558, 562, 560, 565, 21880, 559, 564, 561, 563, 566,
    9075, 4694, 4695, 4696, 4697, 4698, 4699, 28929, 30843,
  ],
};

const ITEM_SIZE = 28;

function ItemButton({
  id,
  selected,
  hidden = false,
  editing = false,
  onClick,
  onRemove,
  onRestore,
}: {
  id: number;
  selected: boolean;
  hidden?: boolean;
  editing?: boolean;
  onClick: (id: number | null) => void;
  onRemove?: (id: number) => void;
  onRestore?: (id: number) => void;
}) {
  const className = [
    styles.item,
    hidden && styles.hidden,
    selected && !editing && styles.selected,
    editing && styles.editing,
  ]
    .filter(Boolean)
    .join(' ');

  const handleClick = () => {
    if (!editing) {
      onClick(selected ? null : id);
    }
  };

  const name = extendedItemCache.getItemName(id);

  return (
    <div className={styles.itemContainer}>
      <button className={className} onClick={handleClick}>
        <Item id={id} name={name} quantity={1} size={ITEM_SIZE} />
      </button>
      {onRemove && (
        <button
          className={styles.remove}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(id);
          }}
          data-tooltip-id={GLOBAL_TOOLTIP_ID}
          data-tooltip-content={`Remove ${name}`}
        >
          <i className="fas fa-times" />
          <span className="sr-only">Remove {name}</span>
        </button>
      )}
      {onRestore && (
        <button
          className={styles.restore}
          onClick={(e) => {
            e.stopPropagation();
            onRestore(id);
          }}
          data-tooltip-id={GLOBAL_TOOLTIP_ID}
          data-tooltip-content={`Restore ${name}`}
        >
          <i className="fas fa-undo" />
          <span className="sr-only">Restore {name}</span>
        </button>
      )}
    </div>
  );
}

function AddButton({ onAdd }: { onAdd: (id: number) => void }) {
  const [searchPosition, setSearchPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const wrapperRef = useRef<HTMLButtonElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchPosition === null) {
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (searchPosition === null) {
        return;
      }

      const inWrapper = wrapperRef.current?.contains(e.target as Node) ?? false;
      const inSearch =
        searchContainerRef.current?.contains(e.target as Node) ?? false;
      if (!inWrapper && !inSearch) {
        setSearchPosition(null);
      }
    };

    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [searchPosition, setSearchPosition]);

  function handleClick() {
    if (wrapperRef.current === null) {
      return;
    }

    const rect = wrapperRef.current.getBoundingClientRect();
    setSearchPosition({
      left: rect.left + rect.width - 320,
      top: rect.top + rect.height + 4,
    });
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  }

  function handleSelect(item: ExtendedItemData) {
    setSearchPosition(null);
    onAdd(item.id);
  }

  const portalRoot =
    typeof document !== 'undefined'
      ? document.getElementById('portal-root')
      : null;

  const className = [styles.item, searchPosition !== null && styles.hasSearch]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={className} onClick={handleClick} ref={wrapperRef}>
      <div
        className={styles.add}
        style={{ width: ITEM_SIZE, height: ITEM_SIZE }}
      >
        <i className="fas fa-plus" />
        {searchPosition !== null && portalRoot
          ? createPortal(
              <div
                className={styles.addSearch}
                style={searchPosition}
                ref={searchContainerRef}
              >
                <ItemSearchInput
                  id="selector-add-item-search"
                  inputRef={inputRef}
                  placeholder="Search for an item to add…"
                  onSelect={handleSelect}
                  onClear={() => setSearchPosition(null)}
                />
              </div>,
              portalRoot,
            )
          : null}
      </div>
    </button>
  );
}

function CategorySection({
  name,
  category,
  customItems,
  removeCustomItem,
  addCustomItem,
  hideDefaultItem,
  showDefaultItem,
  isLoading,
  context,
}: {
  name: string;
  category: ItemCategory;
  customItems: CustomItems;
  removeCustomItem: (category: ItemCategory, id: number) => void;
  addCustomItem: (category: ItemCategory, id: number) => void;
  hideDefaultItem: (category: ItemCategory, id: number) => void;
  showDefaultItem: (category: ItemCategory, id: number) => void;
  isLoading: boolean;
  context: EditingContext;
}) {
  const [editing, setEditing] = useState(false);

  const hiddenItems = new Set(customItems[category].hidden);
  const addedItems = new Set(customItems[category].added);

  const defaultItems = DEFAULT_ITEMS[category].filter((id) => {
    if (addedItems.has(id)) {
      return false;
    }
    return !hiddenItems.has(id) || editing;
  });

  return (
    <>
      <div className={styles.categoryHeader}>
        <h3 className={styles.sectionHeading}>{name}</h3>
        <div className={styles.categoryActions}>
          <button
            className={styles.edit}
            onClick={() => setEditing(!editing)}
            disabled={isLoading}
          >
            <i className={`fas ${editing ? 'fa-check' : 'fa-edit'}`} />
            <span>{editing ? 'Done' : 'Edit'}</span>
          </button>
        </div>
      </div>
      {editing && (
        <div className={styles.editHint}>
          <i className="fas fa-info-circle" />
          <span>
            Click on default items to hide/show them, or add custom items
          </span>
        </div>
      )}
      <div className={`${styles.section} ${editing ? styles.editMode : ''}`}>
        {defaultItems.map((id) => {
          const hidden = hiddenItems.has(id);
          return (
            <ItemButton
              key={id}
              id={id}
              selected={context.selectedItem?.id === id}
              hidden={hidden}
              editing={editing}
              onClick={(id) => context.setSelectedItem(id)}
              onRemove={
                editing && !hidden
                  ? () => hideDefaultItem(category, id)
                  : undefined
              }
              onRestore={
                editing && hidden
                  ? () => showDefaultItem(category, id)
                  : undefined
              }
            />
          );
        })}
        {customItems[category].added.map((id) => (
          <ItemButton
            key={id}
            id={id}
            selected={context.selectedItem?.id === id}
            editing={editing}
            onClick={(id) => context.setSelectedItem(id)}
            onRemove={
              editing ? () => removeCustomItem(category, id) : undefined
            }
          />
        ))}
        {editing && <AddButton onAdd={(id) => addCustomItem(category, id)} />}
      </div>
    </>
  );
}

export function ItemSelector() {
  const showToast = useToast();
  const context = useContext(SetupEditingContext);
  const searchRef = useRef<HTMLInputElement>(null);

  const handleError = useCallback(
    (message: string) => {
      showToast(message, 'error');
    },
    [showToast],
  );

  const {
    customItems,
    isLoading,
    addCustomItem,
    removeCustomItem,
    hideDefaultItem,
    showDefaultItem,
  } = useCustomItems(handleError);

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

  if (context === null) {
    return null;
  }

  return (
    <div className={`${setupStyles.panel} ${styles.itemSelector}`}>
      <h2 className={styles.heading}>Choose an item</h2>
      <div className={styles.selectedItem}>
        {context.selectedItem ? (
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
          <div className={styles.placeholder}>
            <div
              className={styles.placeholderIcon}
              style={{ width: ITEM_SIZE, height: ITEM_SIZE }}
            />
            <span className={styles.name}>No item selected</span>
          </div>
        )}
      </div>
      <div className={styles.search}>
        <ItemSearchInput
          inputRef={searchRef}
          id="selector-item-search"
          displayKey="/"
          onSelect={(item) => context.setSelectedItem(item.id)}
          onClear={() => {
            context.setSelectedItem(null);
            searchRef.current?.blur();
          }}
          showIds={process.env.NODE_ENV === 'development'}
        />
      </div>
      <div className={styles.categories}>
        <CategorySection
          name="Melee"
          category="melee"
          customItems={customItems}
          isLoading={isLoading}
          removeCustomItem={removeCustomItem}
          addCustomItem={addCustomItem}
          hideDefaultItem={hideDefaultItem}
          showDefaultItem={showDefaultItem}
          context={context}
        />
        <CategorySection
          name="Ranged"
          category="ranged"
          customItems={customItems}
          isLoading={isLoading}
          removeCustomItem={removeCustomItem}
          addCustomItem={addCustomItem}
          hideDefaultItem={hideDefaultItem}
          showDefaultItem={showDefaultItem}
          context={context}
        />
        <CategorySection
          name="Magic"
          category="magic"
          customItems={customItems}
          isLoading={isLoading}
          removeCustomItem={removeCustomItem}
          addCustomItem={addCustomItem}
          hideDefaultItem={hideDefaultItem}
          showDefaultItem={showDefaultItem}
          context={context}
        />
        <CategorySection
          name="Supplies"
          category="supplies"
          customItems={customItems}
          isLoading={isLoading}
          removeCustomItem={removeCustomItem}
          addCustomItem={addCustomItem}
          hideDefaultItem={hideDefaultItem}
          showDefaultItem={showDefaultItem}
          context={context}
        />
        <CategorySection
          name="Utility"
          category="utility"
          customItems={customItems}
          isLoading={isLoading}
          removeCustomItem={removeCustomItem}
          addCustomItem={addCustomItem}
          hideDefaultItem={hideDefaultItem}
          showDefaultItem={showDefaultItem}
          context={context}
        />
        <CategorySection
          name="Runes"
          category="runes"
          customItems={customItems}
          isLoading={isLoading}
          removeCustomItem={removeCustomItem}
          addCustomItem={addCustomItem}
          hideDefaultItem={hideDefaultItem}
          showDefaultItem={showDefaultItem}
          context={context}
        />
      </div>
    </div>
  );
}
