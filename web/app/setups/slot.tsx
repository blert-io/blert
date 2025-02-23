import { EquipmentSlot } from '@blert/common';
import { RefObject, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import Item from '@/components/item';
import ItemSearchInput from '@/components/item-search';
import {
  ExtendedItemData,
  extendedItemCache,
} from '@/utils/item-cache/extended';

import { SetupEditingContext } from './editing-context';
import { Container, ItemSlot, getContainerKey } from './setup';
import { SetupViewingContext } from './viewing-context';

import styles from './style.module.scss';

type SlotProps = {
  container: Container;
  index: number;
  playerIndex: number;
  item?: number;
  filter?: (item: ExtendedItemData) => boolean;
};

export function Slot(props: SlotProps) {
  const context = useContext(SetupEditingContext);
  const selectedItem = context?.selectedItem ?? null;
  const { highlightedItemId } = useContext(SetupViewingContext);
  const slotRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const id = `slot-${props.playerIndex}-${props.container}-${props.index}`;
  const isSearchActive = context?.activeSearchSlot === id;

  let className = styles.slot;
  if (props.index === -1) {
    className += ` ${styles.empty}`;
  }

  let canPlace = false;

  if (selectedItem !== null) {
    if (props.filter !== undefined) {
      canPlace = props.filter(selectedItem);
    } else {
      canPlace = true;
    }

    className += ` ${canPlace ? styles.valid : styles.invalid}`;
  }

  if (highlightedItemId === props.item) {
    className += ` ${styles.highlighted}`;
  }

  if (isSearchActive) {
    className += ` ${styles.search}`;
  }

  useEffect(() => {
    if (isSearchActive) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          context?.setActiveSearchSlot(null);
          searchRef.current?.blur();
        }
      };

      const handleClick = (e: MouseEvent) => {
        const target = e.target as Element;
        const searchElement = document.getElementById(id);

        // Don't close if clicking inside the search element or its menu
        if (searchElement?.contains(target) || target.closest('.menu-portal')) {
          return;
        }

        context?.setActiveSearchSlot(null);
      };

      setTimeout(() => {
        searchRef.current?.focus();
      }, 100);

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('click', handleClick);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('click', handleClick);
      };
    }
  }, [isSearchActive, context, id]);

  function placeItem(item: ExtendedItemData) {
    if (context === null || props.index === -1) {
      return;
    }

    context.updatePlayer(props.playerIndex, (prev) => {
      const key = getContainerKey(props.container);

      let slots = prev[key].slots.filter((slot) => slot.index !== props.index);

      if (props.container === Container.EQUIPMENT) {
        if (item.slot === EquipmentSlot.WEAPON && item.stats?.twoHanded) {
          // If adding a two-handed weapon, remove any shield.
          slots = prev[key].slots.filter(
            (slot) => slot.index !== EquipmentSlot.SHIELD,
          );
        } else if (item.slot === EquipmentSlot.SHIELD) {
          // Otherwise, if adding a shield, remove an equipped two-handed
          // weapon.
          const prevWeapon = prev[key].slots.find(
            (slot) => slot.index === EquipmentSlot.WEAPON,
          );
          if (prevWeapon?.item?.id !== undefined) {
            const isTwoHanded =
              extendedItemCache.getItem(prevWeapon.item.id)?.stats?.twoHanded ??
              false;
            if (isTwoHanded) {
              slots = prev[key].slots.filter(
                (slot) => slot.index !== EquipmentSlot.WEAPON,
              );
            }
          }
        }
      } else if (item.stackable) {
        const existingSlot = slots.find((slot) => slot.item?.id === item.id);
        if (existingSlot) {
          return prev;
        }
      }

      const newSlot: ItemSlot = {
        index: props.index,
        item: { id: item.id, quantity: 1 },
        comment: null,
      };

      return {
        ...prev,
        [key]: {
          ...prev[key],
          slots: [...slots, newSlot],
        },
      };
    });
  }

  function onClick(e: React.MouseEvent) {
    if (context === null || props.index === -1) {
      return;
    }

    if (selectedItem !== null && canPlace) {
      placeItem(selectedItem);
    } else if (selectedItem === null) {
      if (props.item !== undefined) {
        // Remove item if one exists
        context.updatePlayer(props.playerIndex, (prev) => {
          const key = getContainerKey(props.container);
          const slots = prev[key].slots.filter(
            (slot) => slot.index !== props.index,
          );
          return { ...prev, [key]: { ...prev[key], slots } };
        });
      } else {
        // Show search if slot is empty
        e.stopPropagation(); // Prevent the click from immediately closing the search
        context.setActiveSearchSlot(id);
      }
    }
  }

  function handleSearchSelect(item: ExtendedItemData) {
    if (props.filter?.(item) ?? true) {
      placeItem(item);
    }
    context?.setActiveSearchSlot(null);
  }

  let content;
  if (props.item !== undefined) {
    const name = extendedItemCache.getItemName(props.item);
    content = (
      <div
        className={styles.itemWrapper}
        data-tooltip-id="slot-tooltip"
        data-tooltip-content={name}
      >
        <Item id={props.item} name={name} quantity={1} size={30} />
      </div>
    );
  } else if (isSearchActive && context !== null) {
    content = (
      <SlotSearch
        id={id}
        container={props.container}
        index={props.index}
        filter={props.filter}
        onSelect={handleSearchSelect}
        onClear={() => context.setActiveSearchSlot(null)}
        searchRef={searchRef}
        slotRef={slotRef}
      />
    );
  } else {
    content = null;
  }

  return (
    <div className={className} onClick={onClick} ref={slotRef}>
      {content}
    </div>
  );
}

const SEARCH_WIDTH = 320;

function SlotSearch(props: {
  id: string;
  container: Container;
  index: number;
  filter?: (item: ExtendedItemData) => boolean;
  onSelect: (item: ExtendedItemData) => void;
  onClear: () => void;
  searchRef: RefObject<HTMLInputElement>;
  slotRef: RefObject<HTMLDivElement>;
}) {
  const portalNode = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const root = document.getElementById('portal-root');

    const menuPortal = document.createElement('div');
    menuPortal.classList.add('slot-search-portal');
    root?.appendChild(menuPortal);
    portalNode.current = menuPortal as HTMLElement;
    setReady(true);

    return () => {
      if (portalNode.current !== null) {
        document
          .getElementById('portal-root')
          ?.removeChild(portalNode.current!);
      }
    };
  }, []);

  if (!ready) {
    return null;
  }

  const position = { left: 0, top: 0, width: SEARCH_WIDTH };
  const slotRect = props.slotRef.current?.getBoundingClientRect();
  if (slotRect !== undefined) {
    position.top = slotRect.top + slotRect.height;
    position.left = slotRect.left;

    if (position.left + SEARCH_WIDTH > window.innerWidth - 20) {
      position.left = window.innerWidth - SEARCH_WIDTH - 20;
    }
  }

  return createPortal(
    <div className={styles.slotSearch} style={position}>
      <ItemSearchInput
        id={`slot-search-${props.id}`}
        slot={props.container === Container.EQUIPMENT ? props.index : undefined}
        placeholder="Search items…"
        predicate={props.filter}
        inputRef={props.searchRef}
        onSelect={props.onSelect}
        onClear={props.onClear}
      />
    </div>,
    portalNode.current!,
  );
}
