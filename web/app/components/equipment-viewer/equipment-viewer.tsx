import { EquipmentMap, EquipmentSlot } from '@blert/common';

import Item from '../item';
import { LigmaTooltip } from '../ligma-tooltip/ligma-tooltip';

import styles from './style.module.scss';
import Image from 'next/image';

type EquipmentViewerProps = {
  equipment: Partial<EquipmentMap>;
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
};

const ITEM_SIZE = 36;

export default function EquipmentViewer(props: EquipmentViewerProps) {
  const items = Object.entries(props.equipment).map(([slot, item]) => {
    const style: React.CSSProperties = {
      position: 'absolute',
      width: ITEM_SIZE,
      height: ITEM_SIZE,
      ...EQUIPMENT_OFFSETS[slot],
    };

    const tooltipId = `${item.name.replaceAll(/[^a-zA-Z0-9]/g, '')}-tooltip`;

    return (
      <>
        <div key={slot} style={style} data-tooltip-id={tooltipId}>
          <Image
            style={{ position: 'absolute', zIndex: 1 }}
            src="/equipment-background.png"
            alt=""
            width={ITEM_SIZE}
            height={ITEM_SIZE}
          />
          <Item
            style={{ zIndex: 2 }}
            name={item.name}
            quantity={item.quantity}
          />
        </div>
        <LigmaTooltip tooltipId={tooltipId}>{item.name}</LigmaTooltip>
      </>
    );
  });

  return (
    <div className={styles.equipmentViewer}>
      <Image
        src="/equipment.png"
        alt="Equipment screen"
        width={182}
        height={240}
      />
      {items}
    </div>
  );
}
