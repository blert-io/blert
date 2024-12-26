import { DataSource, EquipmentSlot } from '@blert/common';
import Image from 'next/image';

import Item from '@/components/item';
import Tooltip from '@/components/tooltip';
import { PlayerEquipment } from '@/utils/boss-room-state';

import styles from './style.module.scss';

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

      const tooltipId = `${username.replace(/[^a-zA-Z0-9_-]/g, '')}-${slot}-tooltip`;

      return (
        <span key={`${slot}-${index}`}>
          <div style={style} data-tooltip-id={tooltipId}>
            <Image
              style={{ position: 'absolute', zIndex: 1 }}
              src="/images/equipment-background.png"
              alt=""
              width={ITEM_SIZE}
              height={ITEM_SIZE}
            />
            <Item
              style={{ zIndex: 2 }}
              name={item.name}
              quantity={item.quantity}
              size={ITEM_SIZE}
            />
          </div>
          <Tooltip key={`tooltip-${slot}`} tooltipId={tooltipId}>
            {item.name}
          </Tooltip>
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
            height: ITEM_SIZE + 7,
            width: ITEM_SIZE + 8,
            top: 49,
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
            height: ITEM_SIZE + 7,
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
      <div key="empty" className={styles.empty} style={{ top: 96, left: 0 }}>
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
