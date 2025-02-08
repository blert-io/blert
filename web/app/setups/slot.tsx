import { EquipmentSlot } from '@blert/common';
import { useContext } from 'react';

import Item from '@/components/item';
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

  function onClick(e: React.MouseEvent) {
    if (context === null || props.index === -1) {
      return;
    }

    if (selectedItem !== null && canPlace) {
      context.updatePlayer(props.playerIndex, (prev) => {
        const key = getContainerKey(props.container);

        let slots = prev[key].slots.filter(
          (slot) => slot.index !== props.index,
        );

        if (props.container === Container.EQUIPMENT) {
          if (
            selectedItem.slot === EquipmentSlot.WEAPON &&
            selectedItem.stats?.twoHanded
          ) {
            // If adding a two-handed weapon, remove any shield.
            slots = prev[key].slots.filter(
              (slot) => slot.index !== EquipmentSlot.SHIELD,
            );
          } else if (selectedItem.slot === EquipmentSlot.SHIELD) {
            // Otherwise, if adding a shield, remove an equipped two-handed
            // weapon.
            const prevWeapon = prev[key].slots.find(
              (slot) => slot.index === EquipmentSlot.WEAPON,
            );
            if (prevWeapon?.item?.id !== undefined) {
              const isTwoHanded =
                extendedItemCache.getItem(prevWeapon.item.id)?.stats
                  ?.twoHanded ?? false;
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
          item: { id: selectedItem.id, quantity: 1 },
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
    } else if (selectedItem === null && props.item !== undefined) {
      context.updatePlayer(props.playerIndex, (prev) => {
        const key = getContainerKey(props.container);
        const slots = prev[key].slots.filter(
          (slot) => slot.index !== props.index,
        );
        return { ...prev, [key]: { ...prev[key], slots } };
      });
    }
  }

  return (
    <div className={className} onClick={onClick}>
      {props.item !== undefined && (
        <Item
          name={extendedItemCache.getItemName(props.item)}
          quantity={1}
          size={30}
        />
      )}
    </div>
  );
}
