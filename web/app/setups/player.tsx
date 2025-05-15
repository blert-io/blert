'use client';

import { EquipmentSlot } from '@blert/common';
import Image from 'next/image';
import { useCallback, useContext, useRef, useState } from 'react';

import EditableTextField from '@/components/editable-text-field';
import Menu, { MenuItem } from '@/components/menu';
import { useToast } from '@/components/toast';
import { ExtendedItemData } from '@/utils/item-cache/extended';

import { EditingContext, SetupEditingContext } from './editing-context';
import { RUNE_ITEMS } from './[id]/edit/item-selector';
import {
  Container,
  GearSetupPlayer,
  ItemSlot,
  NUM_INVENTORY_SLOTS,
  Spellbook,
  newGearSetupPlayer,
  spellbookName,
} from './setup';
import { Slot } from './slot';
import {
  ExportFormat,
  exportPlayer,
  importSetup,
  TranslateError,
} from './translate';
import { SetupViewingContext } from './viewing-context';

import styles from './style.module.scss';

type PlayerProps = {
  index: number;
  player: GearSetupPlayer;
};

function slotsByIndex(slots: ItemSlot[]): Record<number, ItemSlot> {
  return slots.reduce((acc, slot) => ({ ...acc, [slot.index]: slot }), {});
}

const QUIVER_IDS = [28955, 28902, 28951];

function hasQuiver(player: GearSetupPlayer): boolean {
  return (
    player.equipment.slots.some((slot) =>
      QUIVER_IDS.includes(slot.item?.id ?? 0),
    ) ||
    player.inventory.slots.some((slot) =>
      QUIVER_IDS.includes(slot.item?.id ?? 0),
    )
  );
}

function typeFilter(slot: EquipmentSlot): (item: ExtendedItemData) => boolean {
  return (item) => item.slot === slot;
}

function runeFilter(item: ExtendedItemData): boolean {
  return RUNE_ITEMS.includes(item.id);
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

const EXPORT_MENU: MenuItem[] = [
  { label: 'Export as…' },
  { label: 'Inventory Setups', value: 'inventory-setups' },
];

export function Player({ index, player }: PlayerProps) {
  const editingContext = useContext(SetupEditingContext);
  const { highlightedPlayerIndex } = useContext(SetupViewingContext);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const sendToast = useToast();

  const slotsByContainer = {
    [Container.INVENTORY]: slotsByIndex(player.inventory.slots),
    [Container.EQUIPMENT]: slotsByIndex(player.equipment.slots),
    [Container.POUCH]: slotsByIndex(player.pouch.slots),
  };

  const isHighlighted = highlightedPlayerIndex === index;
  const className = `${styles.player}${isHighlighted ? ` ${styles.highlighted}` : ''}`;

  const handleExport = useCallback(
    (format: ExportFormat) => {
      try {
        const exported = exportPlayer(player, format);
        navigator.clipboard.writeText(exported);
        sendToast(`Setup for ${player.name} copied to clipboard`);
      } catch (e) {
        if (e instanceof TranslateError) {
          const error = e as TranslateError;
          sendToast(`Failed to export player: ${error.message}`, 'error');
        } else {
          sendToast('Failed to export player', 'error');
        }
      }

      setExportMenuOpen(false);
    },
    [player, sendToast, setExportMenuOpen],
  );

  const handleImport = useCallback(async () => {
    const clipboard = navigator.clipboard;
    if (!clipboard || editingContext === null) {
      return;
    }

    try {
      const text = await clipboard.readText();
      const setup = importSetup(text);
      editingContext.updatePlayer(index, (_) => setup);
    } catch (error: any) {
      if (error instanceof TranslateError) {
        const e = error as TranslateError;
        sendToast(
          `Failed to import setup from clipboard: ${e.message}`,
          'error',
        );
      } else {
        sendToast('Failed to import setup from clipboard', 'error');
      }
    }
  }, [sendToast, editingContext, index]);

  return (
    <div className={className}>
      <div className={styles.header}>
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
          <h2 className={styles.name}>
            {player.name}
            <div className={styles.playerActions}>
              <button
                className={styles.shareButton}
                onClick={() => {
                  const url = new URL(window.location.href);
                  url.searchParams.set('player', (index + 1).toString());
                  navigator.clipboard.writeText(url.toString());
                  sendToast(`Link to ${player.name} copied to clipboard`);
                }}
                title="Copy link to this player"
              >
                <i className="fas fa-link" />
                <span className="sr-only">Copy link to this player</span>
              </button>
              <button
                id={`player-${index}-export`}
                className={styles.shareButton}
                onClick={() => setExportMenuOpen(true)}
              >
                <i className="fas fa-download" />
                <span className="sr-only">Export player</span>
              </button>
            </div>
            <Menu
              items={EXPORT_MENU}
              onSelection={(value) => handleExport(value as ExportFormat)}
              open={exportMenuOpen}
              onClose={() => setExportMenuOpen(false)}
              targetId={`player-${index}-export`}
              width={160}
            />
          </h2>
        )}
      </div>
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
      <div
        className={`${styles.slotContainer} ${styles.spellbook}`}
        data-tooltip-id="slot-tooltip"
        data-tooltip-content={`${spellbookName(player.spellbook)} spellbook`}
      >
        <SpellbookIcon
          context={editingContext}
          index={index}
          player={player}
          readonly={editingContext === null}
        />
      </div>
      {editingContext !== null && (
        <div className={styles.editActions}>
          <button className={styles.import} onClick={handleImport}>
            <i className="fas fa-upload" />
            Import from clipboard
          </button>
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
        </div>
      )}
    </div>
  );
}

const SPELLBOOK_MENU_ITEMS: MenuItem[] = [
  { label: spellbookName(Spellbook.STANDARD), value: Spellbook.STANDARD },
  { label: spellbookName(Spellbook.ANCIENT), value: Spellbook.ANCIENT },
  { label: spellbookName(Spellbook.LUNAR), value: Spellbook.LUNAR },
  { label: spellbookName(Spellbook.ARCEUUS), value: Spellbook.ARCEUUS },
];

function SpellbookIcon({
  context,
  player,
  index,
  readonly,
}: {
  context: EditingContext | null;
  player: GearSetupPlayer;
  index: number;
  readonly: boolean;
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

  const rect = slotRef.current?.getBoundingClientRect();

  return (
    <div
      className={`${styles.slot} ${styles.spellbookSlot} ${readonly ? styles.readonly : ''}`}
      onClick={() => {
        if (context !== null && !readonly) {
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
            rect
              ? {
                  x: rect.left,
                  y:
                    rect.top + 150 > window.innerHeight
                      ? rect.top - 112
                      : rect.top + 42,
                }
              : { x: 0, y: 0 }
          }
        />
      )}
    </div>
  );
}
