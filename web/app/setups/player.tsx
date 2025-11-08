'use client';

import { EquipmentSlot } from '@blert/common';
import Image from 'next/image';
import { useCallback, useContext, useRef, useState } from 'react';

import EditableTextField from '@/components/editable-text-field';
import Menu, { MenuItem } from '@/components/menu';
import { useToast } from '@/components/toast';

import { EditingContext, SetupEditingContext } from './editing-context';
import { getSlotMetadata, SLOT_SIZE_PX } from './container-grid';
import { SelectableContainer } from './selectable-container';
import {
  Container,
  GearSetupPlayer,
  ItemSlot,
  NUM_INVENTORY_SLOTS,
  NUM_POUCH_SLOTS,
  QUIVER_SLOT_INDEX,
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

const EQUIPMENT_LAYOUT: Array<EquipmentSlot | null> = [
  null,
  EquipmentSlot.HEAD,
  QUIVER_SLOT_INDEX,
  EquipmentSlot.CAPE,
  EquipmentSlot.AMULET,
  EquipmentSlot.AMMO,
  EquipmentSlot.WEAPON,
  EquipmentSlot.TORSO,
  EquipmentSlot.SHIELD,
  null,
  EquipmentSlot.LEGS,
  null,
  EquipmentSlot.GLOVES,
  EquipmentSlot.BOOTS,
  EquipmentSlot.RING,
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
    <div
      className={className}
      style={{ '--slot-size': `${SLOT_SIZE_PX}px` } as React.CSSProperties}
    >
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
      <SelectableContainer
        container={Container.EQUIPMENT}
        playerIndex={index}
        className={`${styles.slotContainer} ${styles.equipment}`}
      >
        {EQUIPMENT_LAYOUT.map((slotIndex, i) => {
          if (slotIndex === null) {
            return (
              <Slot
                container={Container.EQUIPMENT}
                playerIndex={index}
                index={-1}
                key={i}
              />
            );
          }

          const slotMetadata = getSlotMetadata(Container.EQUIPMENT, slotIndex);

          if (slotMetadata?.condition && !slotMetadata.condition(player)) {
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
              item={slotsByContainer[Container.EQUIPMENT][slotIndex]?.item?.id}
              index={slotIndex}
              filter={slotMetadata?.typeFilter}
              key={i}
            />
          );
        })}
      </SelectableContainer>
      <SelectableContainer
        container={Container.INVENTORY}
        playerIndex={index}
        className={`${styles.slotContainer} ${styles.inventory}`}
      >
        {Array.from({ length: NUM_INVENTORY_SLOTS }, (_, i) => (
          <Slot
            container={Container.INVENTORY}
            playerIndex={index}
            item={slotsByContainer[Container.INVENTORY][i]?.item?.id}
            index={i}
            key={i}
          />
        ))}
      </SelectableContainer>
      <SelectableContainer
        container={Container.POUCH}
        playerIndex={index}
        className={`${styles.slotContainer} ${styles.pouch}`}
      >
        {Array.from({ length: NUM_POUCH_SLOTS }, (_, i) => i).map(
          (slotIndex) => {
            const slotMetadata = getSlotMetadata(Container.POUCH, slotIndex);
            return (
              <Slot
                key={slotIndex}
                container={Container.POUCH}
                playerIndex={index}
                item={slotsByContainer[Container.POUCH][slotIndex]?.item?.id}
                index={slotIndex}
                filter={slotMetadata?.typeFilter}
              />
            );
          },
        )}
      </SelectableContainer>
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
