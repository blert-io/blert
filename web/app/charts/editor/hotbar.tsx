'use client';

import { BCFAction } from '@blert/bcf';
import Image from 'next/image';

import { getActionMetadata } from '@/components/attack-timeline';

import { attackCooldown } from './attack-cycle';
import { DismissButton } from './dismiss-button';

import styles from './hotbar.module.scss';

type HotbarProps = {
  brush: BCFAction | null;
  onClearBrush: () => void;
};

export function Hotbar({ brush, onClearBrush }: HotbarProps) {
  return (
    <div className={styles.brush}>
      <span className={styles.label}>Brush</span>
      {brush === null ? (
        <span className={styles.empty}>None</span>
      ) : (
        <BrushChip brush={brush} onClear={onClearBrush} />
      )}
    </div>
  );
}

type BrushChipProps = {
  brush: BCFAction;
  onClear: () => void;
};

function BrushChip({ brush, onClear }: BrushChipProps) {
  const { name, imageUrl } = getActionMetadata(brush);
  return (
    <span className={styles.chip}>
      {imageUrl !== undefined && (
        <Image src={imageUrl} alt="" width={26} height={26} />
      )}
      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        {brush.type === 'attack' && (
          <span className={styles.meta}>
            {attackCooldown(brush.attackType)}t
          </span>
        )}
      </span>
      <DismissButton label="Clear brush" onClick={onClear} />
    </span>
  );
}
