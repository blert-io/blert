'use client';

import { EquipmentSlot } from '@blert/common';
import { RefObject, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import Item from '@/components/item';
import ItemSearchInput from '@/components/item-search';
import {
  ExtendedItemData,
  extendedItemCache,
} from '@/utils/item-cache/extended';

import { indexToCoords, slotIdToString } from './container-grid';
import { OperationMode, SetupEditingContext } from './editing-context';
import { Container, ItemSlot, getContainerKey } from './setup';
import { SetupViewingContext } from './viewing-context';

import styles from './style.module.scss';

const SLOT_TOOLTIP_ID = 'slot-tooltip';

type SlotProps = {
  container: Container;
  index: number;
  playerIndex: number;
  item?: number;
  comment?: string | null;
  filter?: (item: ExtendedItemData) => boolean;
};

export function Slot(props: SlotProps) {
  const context = useContext(SetupEditingContext);
  const selectedItem = context?.selectedItem ?? null;
  const { highlightedItemId } = useContext(SetupViewingContext);
  const slotRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [altHeld, setAltHeld] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const id = slotIdToString({
    playerIndex: props.playerIndex,
    container: props.container,
    index: props.index,
  });
  const isSearchActive = context?.activeSearchSlot === id;

  let className = styles.slot;
  if (props.index === -1) {
    className += ` ${styles.empty}`;
  }

  let canPlace = false;

  if (selectedItem !== null && !altHeld) {
    if (props.filter !== undefined) {
      canPlace = props.filter(selectedItem);
    } else {
      canPlace = true;
    }

    className += ` ${canPlace ? styles.valid : styles.invalid}`;
  }

  if (
    selectedItem === null &&
    !altHeld &&
    props.item !== undefined &&
    isHovered &&
    context !== null
  ) {
    className += ` ${styles.deletable}`;
  }

  if (highlightedItemId === props.item) {
    className += ` ${styles.highlighted}`;
  }

  if (isSearchActive) {
    className += ` ${styles.search}`;
  }

  if (altHeld && props.item !== undefined && context !== null) {
    if (isHovered) {
      className += ` ${styles.eyedropperHover}`;
    } else {
      className += ` ${styles.eyedropperHint}`;
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!context?.isPlacementMode && e.key === 'Alt') {
        setAltHeld(true);
      }
      if (isSearchActive && e.key === 'Escape') {
        context?.setActiveSearchSlot(null);
        searchRef.current?.blur();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setAltHeld(false);
      }
    };

    const handleClick = (e: MouseEvent) => {
      if (!isSearchActive) {
        return;
      }

      const target = e.target as Element;
      const searchElement = document.getElementById(id);

      // Don't close if clicking inside the search element or its menu
      if (searchElement?.contains(target) || target.closest('.menu-portal')) {
        return;
      }

      context?.setActiveSearchSlot(null);
    };

    if (isSearchActive) {
      setTimeout(() => {
        searchRef.current?.focus();
      }, 100);
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('click', handleClick);
    };
  }, [isSearchActive, context, id]);

  function placeItem(item: ExtendedItemData) {
    if (context === null || props.index === -1) {
      return;
    }

    context.updatePlayer(props.playerIndex, (prev) => {
      const key = getContainerKey(props.container);

      let slots = prev[key].slots.filter((slot) => slot.index !== props.index);

      if (item.stackable) {
        const existingSlot = slots.find((slot) => slot.item?.id === item.id);
        if (existingSlot) {
          return prev;
        }
      }

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

    if (context.operationMode === OperationMode.DRAGGING) {
      // Drag completion is handled by the container.
      return;
    }

    if (
      context.operationMode === OperationMode.CLIPBOARD_CUT ||
      context.operationMode === OperationMode.CLIPBOARD_COPY
    ) {
      const gridCoords = indexToCoords(props.index, props.container);
      if (gridCoords === null) {
        return;
      }

      e.preventDefault();
      context.applyClipboard(props.container, props.playerIndex, gridCoords);
      return;
    }

    if (context.selection !== null) {
      context.clearSelection();
    }

    // Alt+Click to select the item from this slot.
    if (e.altKey && props.item !== undefined) {
      e.preventDefault();
      context.setSelectedItem(props.item);
      return;
    }

    if (selectedItem !== null && canPlace) {
      placeItem(selectedItem);
    } else if (selectedItem === null) {
      if (props.item !== undefined) {
        // Remove item if one exists.
        context.updatePlayer(props.playerIndex, (prev) => {
          const key = getContainerKey(props.container);
          const slots = prev[key].slots.filter(
            (slot) => slot.index !== props.index,
          );
          return { ...prev, [key]: { ...prev[key], slots } };
        });
      } else {
        // Show search if slot is empty.
        e.stopPropagation(); // Prevent click from immediately closing search.
        context.setActiveSearchSlot(id);
      }
    }
  }

  function handleSearchSelect(item: ExtendedItemData) {
    if (props.filter?.(item) ?? true) {
      placeItem(item);
      setIsHovered(false);
    }
    context?.setActiveSearchSlot(null);
  }

  let content;
  if (props.item !== undefined) {
    const name = extendedItemCache.getItemName(props.item);

    const tooltipProps: Record<string, string> = {
      'data-tooltip-id': SLOT_TOOLTIP_ID,
      'data-tooltip-item-name': name,
    };

    if (props.comment) {
      tooltipProps['data-tooltip-comment'] = props.comment;
    }

    content = (
      <div className={styles.itemWrapper} {...tooltipProps}>
        <Item
          id={props.item}
          name={name}
          quantity={1}
          size={30}
          data-slot-item={props.item}
        />
      </div>
    );
  } else if (props.comment) {
    const tooltipProps: Record<string, string> = {
      'data-tooltip-id': SLOT_TOOLTIP_ID,
      'data-tooltip-comment': props.comment,
    };

    content = <div className={styles.itemWrapper} {...tooltipProps} />;
  }

  const handleMouseEnter = () => {
    const mode = context?.operationMode;
    if (
      mode === OperationMode.ITEM_PLACEMENT ||
      mode === OperationMode.SELECTION
    ) {
      setIsHovered(true);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  return (
    <div
      className={className}
      id={id}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      ref={slotRef}
      data-slot="true"
    >
      {content}
      {props.comment && <CommentBadge />}
      {isSearchActive && context !== null && (
        <SlotSearch
          id={id}
          container={props.container}
          index={props.index}
          filter={props.filter}
          onSelect={handleSearchSelect}
          onClear={() => context?.setActiveSearchSlot(null)}
          searchRef={searchRef}
          slotRef={slotRef}
        />
      )}
    </div>
  );
}

function CommentBadge() {
  return (
    <div className={styles.commentBadge}>
      <i className="fas fa-comment" />
    </div>
  );
}

export function SlotTooltipRenderer({
  activeAnchor,
}: {
  activeAnchor: HTMLElement | null;
}) {
  if (!activeAnchor) {
    return null;
  }

  const itemName = activeAnchor.dataset.tooltipItemName;
  const comment = activeAnchor.dataset.tooltipComment;

  if (!itemName && !comment) {
    return null;
  }

  if (!comment) {
    return itemName;
  }

  return (
    <div className={styles.slotTooltipContent}>
      {itemName && (
        <div className={styles.tooltipHeader}>
          <span>{itemName}</span>
        </div>
      )}
      <div className={styles.commentSection}>
        <i className="fas fa-comment" />
        <span className={styles.commentText}>{comment}</span>
      </div>
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
  searchRef: RefObject<HTMLInputElement | null>;
  slotRef: RefObject<HTMLDivElement | null>;
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
