import { DataSource, EquipmentSlot } from '@blert/common';
import Image from 'next/image';

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

const EQUIPMENT_OFFSETS: { [key: string]: React.CSSProperties } = {
  [EquipmentSlot.HEAD]: { top: 3, left: 73 },
  [EquipmentSlot.CAPE]: { top: 53, left: 22 },
  [EquipmentSlot.AMULET]: { top: 53, left: 73 },
  [EquipmentSlot.AMMO]: { top: 53, left: 124 },
  [EquipmentSlot.WEAPON]: { top: 101, left: 3 },
  [EquipmentSlot.TORSO]: { top: 101, left: 73 },
  [EquipmentSlot.SHIELD]: { top: 101, left: 142 },
  [EquipmentSlot.LEGS]: { top: 151, left: 73 },
  [EquipmentSlot.GLOVES]: { top: 201, left: 3 },
  [EquipmentSlot.BOOTS]: { top: 201, left: 73 },
  [EquipmentSlot.RING]: { top: 201, left: 142 },
  [EquipmentSlot.QUIVER]: { top: 3, left: 124 },
};

const ITEM_SIZE = 36;

export default function EquipmentViewer(props: EquipmentViewerProps) {
  const { equipment, username, source = DataSource.SECONDARY } = props;
  let items: React.ReactNode[] = [];

  let className = styles.equipmentViewer;
  if (props.className) {
    className += ` ${props.className}`;
  }

  const hasQuiver = !!equipment?.[EquipmentSlot.QUIVER];

  if (equipment) {
    items = Object.entries(equipment).map(([slot, item], index) => {
      if (item === null) {
        return null;
      }

      const style: React.CSSProperties = {
        position: 'absolute',
        width: ITEM_SIZE,
        height: ITEM_SIZE,
        ...EQUIPMENT_OFFSETS[slot],
      };

      const tooltipContent = `${item.quantity > 1 ? `${item.quantity.toLocaleString()}× ` : ''}${item.name}`;

      return (
        <span key={`${slot}-${index}`}>
          <div
            style={style}
            data-tooltip-id={GLOBAL_TOOLTIP_ID}
            data-tooltip-content={tooltipContent}
          >
            <Image
              style={{ position: 'absolute', zIndex: 1 }}
              src="/images/equipment-background.png"
              alt=""
              width={ITEM_SIZE}
              height={ITEM_SIZE}
            />
            <Item
              style={{ zIndex: 2 }}
              id={item.id}
              name={item.name}
              quantity={item.quantity}
              size={ITEM_SIZE}
            />
          </div>
        </span>
      );
    });

    if (source === DataSource.SECONDARY) {
      items.push(
        <div
          className={styles.missing}
          key={`${username}-${EquipmentSlot.AMMO}`}
          style={{
            position: 'absolute',
            height: ITEM_SIZE + 8,
            width: ITEM_SIZE + 8,
            top: 48,
            left: 120,
          }}
        >
          No data
        </div>,
        <div
          className={styles.missing}
          key={`${username}-${EquipmentSlot.RING}`}
          style={{
            position: 'absolute',
            height: ITEM_SIZE + 8,
            width: ITEM_SIZE + 8,
            top: 197,
            left: 139,
          }}
        >
          No data
        </div>,
      );
    }
  } else {
    items.push(
      <div key="empty" className={styles.empty} style={{ top: 96 }}>
        No equipment data available.
      </div>,
    );
  }

  return (
    <div className={className}>
      <Image
        src={`/images/equipment${hasQuiver ? '-quiver' : ''}.png`}
        alt="Equipment screen"
        width={182}
        height={240}
        priority
      />
      {items}
    </div>
  );
}
