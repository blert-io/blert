import { DataSource, EquipmentSlot } from '@blert/common';

import Item from '@/components/item';
import { PlayerEquipment } from '@/utils/boss-room-state';

import styles from './style.module.scss';
import { GLOBAL_TOOLTIP_ID } from '../tooltip';

type EquipmentViewerProps = {
  className?: string;
  username: string;
  equipment: PlayerEquipment | null;
  source?: DataSource;
};

type SlotLayout = {
  top: number;
  left: number;
  baseIcon: string;
};

const EQUIPMENT_SLOTS: Record<string, SlotLayout> = {
  [EquipmentSlot.HEAD]: { top: 3, left: 59, baseIcon: 'head' },
  [EquipmentSlot.CAPE]: { top: 42, left: 18, baseIcon: 'cape' },
  [EquipmentSlot.AMULET]: { top: 42, left: 59, baseIcon: 'amulet' },
  [EquipmentSlot.AMMO]: { top: 42, left: 100, baseIcon: 'ammo' },
  [EquipmentSlot.WEAPON]: { top: 81, left: 3, baseIcon: 'weapon' },
  [EquipmentSlot.TORSO]: { top: 81, left: 59, baseIcon: 'torso' },
  [EquipmentSlot.SHIELD]: { top: 81, left: 115, baseIcon: 'shield' },
  [EquipmentSlot.LEGS]: { top: 121, left: 59, baseIcon: 'legs' },
  [EquipmentSlot.GLOVES]: { top: 161, left: 3, baseIcon: 'gloves' },
  [EquipmentSlot.BOOTS]: { top: 161, left: 59, baseIcon: 'boots' },
  [EquipmentSlot.RING]: { top: 161, left: 115, baseIcon: 'ring' },
  [EquipmentSlot.QUIVER]: { top: 3, left: 100, baseIcon: 'ammo' },
};

const SCREEN_WIDTH = 154;
const SCREEN_HEIGHT = 200;
const SLOT_SIZE = 36;
const ICON_SIZE = 32;

const PIXELATED: React.CSSProperties = { imageRendering: 'pixelated' };

// The equipment viewer needs to constantly re-render during live views, and
// Next's Image adds a lot of unnecessary rendering overhead.
/* eslint-disable @next/next/no-img-element */

export default function EquipmentViewer(props: EquipmentViewerProps) {
  const { equipment, username, source = DataSource.SECONDARY } = props;

  let className = styles.equipmentViewer;
  if (props.className) {
    className += ` ${props.className}`;
  }

  const hasQuiver = !!equipment?.[EquipmentSlot.QUIVER];

  const items: React.ReactNode[] = Object.entries(EQUIPMENT_SLOTS).map(
    ([key, { top, left, baseIcon: icon }]) => {
      const slot = Number(key);
      const item = equipment?.[slot] ?? null;

      if (item === null) {
        // The quiver slot is only shown when it holds ammo.
        if (slot === EquipmentSlot.QUIVER) {
          return null;
        }
        const offset = (SLOT_SIZE - ICON_SIZE) / 2;
        return (
          <img
            key={key}
            src={`/images/equipment/slot-${icon}.png`}
            alt=""
            width={ICON_SIZE}
            height={ICON_SIZE}
            style={{
              ...PIXELATED,
              position: 'absolute',
              top: top + offset,
              left: left + offset,
            }}
          />
        );
      }

      const tooltipContent = `${item.quantity > 1 ? `${item.quantity.toLocaleString()}× ` : ''}${item.name}`;

      return (
        <div
          key={key}
          style={{
            position: 'absolute',
            width: SLOT_SIZE,
            height: SLOT_SIZE,
            top,
            left,
          }}
          data-tooltip-id={GLOBAL_TOOLTIP_ID}
          data-tooltip-content={tooltipContent}
        >
          <Item
            id={item.id}
            name={item.name}
            quantity={item.quantity}
            size={SLOT_SIZE}
            pixelated
          />
        </div>
      );
    },
  );

  if (!equipment) {
    items.push(
      <div key="empty" className={styles.empty} style={{ top: 80 }}>
        No equipment data available.
      </div>,
    );
  } else if (source === DataSource.SECONDARY) {
    for (const slot of [EquipmentSlot.AMMO, EquipmentSlot.RING]) {
      const { top, left } = EQUIPMENT_SLOTS[slot];
      items.push(
        <div
          className={styles.missing}
          key={`${username}-${slot}`}
          style={{
            position: 'absolute',
            height: SLOT_SIZE + 2,
            width: SLOT_SIZE + 2,
            top: top - 1,
            left: left - 1,
          }}
        >
          No data
        </div>,
      );
    }
  }

  return (
    <div className={className}>
      <img
        src={`/images/equipment/background${hasQuiver ? '-quiver' : ''}.png`}
        alt="Equipment screen"
        width={SCREEN_WIDTH}
        height={SCREEN_HEIGHT}
        style={PIXELATED}
      />
      {items}
    </div>
  );
}
