import { BCFAction } from '@blert/bcf';
import Image from 'next/image';

import { getActionMetadata } from '@/components/attack-timeline';

import styles from './action-icon.module.scss';

type ActionIconProps = {
  action: BCFAction;
  size: number;
};

export function ActionIcon({ action, size }: ActionIconProps) {
  const { imageUrl, badgeUrl } = getActionMetadata(action);
  if (imageUrl === undefined) {
    return null;
  }

  const badgeSize = Math.ceil(size / 2);
  return (
    <span className={styles.icon} style={{ width: size, height: size }}>
      <Image
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        style={{ objectFit: 'contain' }}
      />
      {badgeUrl !== undefined && (
        <Image
          className={styles.badge}
          src={badgeUrl}
          alt=""
          width={badgeSize}
          height={badgeSize}
        />
      )}
    </span>
  );
}
