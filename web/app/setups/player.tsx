import { EquipmentSlot } from '@blert/common';
import Image from 'next/image';
import { useContext, useRef, useState } from 'react';

import EditableTextField from '@/components/editable-text-field';
import Menu, { MenuItem } from '@/components/menu';
import { ExtendedItemData } from '@/utils/item-cache/extended';

import { EditingContext, SetupEditingContext } from './editing-context';
import {
  Container,
  GearSetupPlayer,
  ItemSlot,
  NUM_INVENTORY_SLOTS,
  Spellbook,
  newGearSetupPlayer,
} from './setup';
import { Slot } from './slot';

import styles from './style.module.scss';

type PlayerProps = {
  index: number;
  player: GearSetupPlayer;
};

function slotsByIndex(slots: ItemSlot[]): Record<number, ItemSlot> {
  return slots.reduce((acc, slot) => ({ ...acc, [slot.index]: slot }), {});
}

const QUIVER_ID = 28951;

function hasQuiver(player: GearSetupPlayer): boolean {
  return (
    player.equipment.slots.some((slot) => slot.item?.id === QUIVER_ID) ||
    player.inventory.slots.some((slot) => slot.item?.id === QUIVER_ID)
  );
}

function typeFilter(slot: EquipmentSlot): (item: ExtendedItemData) => boolean {
  return (item) => item.slot === slot;
}

function runeFilter(item: ExtendedItemData): boolean {
  return [
    554, 555, 556, 557, 558, 562, 560, 565, 21880, 559, 564, 561, 563, 566,
    9075, 4695, 4696, 4697, 4698, 4699, 28929,
  ].includes(item.id);
}

type EquipmentSlotMetadata = {
  index: number;
  filter: (item: ExtendedItemData) => boolean;
  condition?: (player: GearSetupPlayer) => boolean;
};

const EQUIPMENT_SLOTS: Array<EquipmentSlotMetadata | null> = [
  null,
  { index: EquipmentSlot.HEAD, filter: typeFilter(EquipmentSlot.HEAD) },
  { index: 99, filter: typeFilter(EquipmentSlot.AMMO), condition: hasQuiver },
  { index: EquipmentSlot.CAPE, filter: typeFilter(EquipmentSlot.CAPE) },
  { index: EquipmentSlot.AMULET, filter: typeFilter(EquipmentSlot.AMULET) },
  { index: EquipmentSlot.AMMO, filter: typeFilter(EquipmentSlot.AMMO) },
  { index: EquipmentSlot.WEAPON, filter: typeFilter(EquipmentSlot.WEAPON) },
  { index: EquipmentSlot.TORSO, filter: typeFilter(EquipmentSlot.TORSO) },
  { index: EquipmentSlot.SHIELD, filter: typeFilter(EquipmentSlot.SHIELD) },
  null,
  { index: EquipmentSlot.LEGS, filter: typeFilter(EquipmentSlot.LEGS) },
  null,
  { index: EquipmentSlot.GLOVES, filter: typeFilter(EquipmentSlot.GLOVES) },
  { index: EquipmentSlot.BOOTS, filter: typeFilter(EquipmentSlot.BOOTS) },
  { index: EquipmentSlot.RING, filter: typeFilter(EquipmentSlot.RING) },
];

export function Player({ index, player }: PlayerProps) {
  const editingContext = useContext(SetupEditingContext);

  const slotsByContainer = {
    [Container.INVENTORY]: slotsByIndex(player.inventory.slots),
    [Container.EQUIPMENT]: slotsByIndex(player.equipment.slots),
    [Container.POUCH]: slotsByIndex(player.pouch.slots),
  };

  return (
    <div className={styles.player}>
      {editingContext !== null ? (
        <EditableTextField
          className={styles.name}
          value={player.name}
          onChange={(value) =>
            editingContext?.updatePlayer(index, (prev) => ({
              ...prev,
              name: value,
            }))
          }
          tag="h2"
          width={200}
        />
      ) : (
        <h2 className={styles.name}>{player.name}</h2>
      )}
      <div className={`${styles.slotContainer} ${styles.equipment}`}>
        {EQUIPMENT_SLOTS.map((slot, i) => {
          if (slot === null || (slot.condition && !slot.condition(player))) {
            return (
              <Slot
                container={Container.EQUIPMENT}
                playerIndex={index}
                index={-1}
                key={i}
              />
            );
          }

          return (
            <Slot
              container={Container.EQUIPMENT}
              playerIndex={index}
              item={slotsByContainer[Container.EQUIPMENT][slot.index]?.item?.id}
              index={slot.index}
              filter={slot.filter}
              key={i}
            />
          );
        })}
      </div>
      <div className={`${styles.slotContainer} ${styles.inventory}`}>
        {Array.from({ length: NUM_INVENTORY_SLOTS }, (_, i) => (
          <Slot
            container={Container.INVENTORY}
            playerIndex={index}
            item={slotsByContainer[Container.INVENTORY][i]?.item?.id}
            index={i}
            key={i}
          />
        ))}
      </div>
      <div className={`${styles.slotContainer} ${styles.pouch}`}>
        <Slot
          container={Container.POUCH}
          playerIndex={index}
          item={slotsByContainer[Container.POUCH][0]?.item?.id}
          index={0}
          filter={runeFilter}
        />
        <Slot
          container={Container.POUCH}
          playerIndex={index}
          item={slotsByContainer[Container.POUCH][1]?.item?.id}
          index={1}
          filter={runeFilter}
        />
        <Slot
          container={Container.POUCH}
          playerIndex={index}
          item={slotsByContainer[Container.POUCH][2]?.item?.id}
          index={2}
          filter={runeFilter}
        />
        <Slot
          container={Container.POUCH}
          playerIndex={index}
          item={slotsByContainer[Container.POUCH][3]?.item?.id}
          index={3}
          filter={runeFilter}
        />
      </div>
      <div className={`${styles.slotContainer} ${styles.spellbook}`}>
        <SpellbookIcon context={editingContext} index={index} player={player} />
      </div>
      {editingContext !== null && (
        <button
          className={styles.remove}
          onClick={() =>
            editingContext.update((prev) => {
              let newPlayers;
              if (prev.players.length <= 1) {
                newPlayers = [newGearSetupPlayer(1)];
              } else {
                newPlayers = prev.players.filter((_, i) => i !== index);
              }
              return { ...prev, players: newPlayers };
            })
          }
        >
          <i className="fas fa-trash" />
          <span>Remove</span>
        </button>
      )}
    </div>
  );
}

const SPELLBOOK_MENU_ITEMS: MenuItem[] = [
  { label: 'Standard', value: Spellbook.STANDARD },
  { label: 'Ancient', value: Spellbook.ANCIENT },
  { label: 'Lunar', value: Spellbook.LUNAR },
  { label: 'Arceuus', value: Spellbook.ARCEUUS },
];

function SpellbookIcon({
  context,
  player,
  index,
}: {
  context: EditingContext | null;
  player: GearSetupPlayer;
  index: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);

  let url;
  switch (player.spellbook) {
    case Spellbook.STANDARD:
      url = '/images/gear/spellbook_standard.webp';
      break;
    case Spellbook.ANCIENT:
      url = '/images/gear/spellbook_ancient.webp';
      break;
    case Spellbook.LUNAR:
      url = '/images/gear/spellbook_lunar.webp';
      break;
    case Spellbook.ARCEUUS:
      url = '/images/gear/spellbook_arceuus.png';
      break;
  }

  return (
    <div
      className={`${styles.slot} ${styles.spellbookSlot}`}
      onClick={() => {
        if (context !== null) {
          setMenuOpen(true);
        }
      }}
      ref={slotRef}
    >
      <Image src={url} alt="Spellbook" width={30} height={30} />
      {menuOpen && (
        <Menu
          items={SPELLBOOK_MENU_ITEMS}
          onSelection={(value) =>
            context?.updatePlayer(index, (prev) => ({
              ...prev,
              spellbook: value as Spellbook,
            }))
          }
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          position={
            slotRef.current
              ? {
                  x: slotRef.current.offsetLeft,
                  y: slotRef.current.offsetTop + 42,
                }
              : { x: 0, y: 0 }
          }
        />
      )}
    </div>
  );
}
