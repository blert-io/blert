import { Prayer, PrayerSet, RawPrayerSet } from '@blert/common';

import styles from './style.module.scss';
import Image from 'next/image';

type KeyPrayersProps = {
  prayerSet: RawPrayerSet;
};

type PrayerDescriptor = { name: string; imageUrl: string };

const KEY_PRAYERS: [Prayer, PrayerDescriptor][] = [
  [
    Prayer.PROTECT_FROM_MAGIC,
    {
      name: 'Protect from Magic',
      imageUrl: '/images/prayers/protect-from-magic.webp',
    },
  ],
  [
    Prayer.PROTECT_FROM_MISSILES,
    {
      name: 'Protect from Missiles',
      imageUrl: '/images/prayers/protect-from-missiles.webp',
    },
  ],
  [
    Prayer.PROTECT_FROM_MELEE,
    {
      name: 'Protect from Melee',
      imageUrl: '/images/prayers/protect-from-melee.webp',
    },
  ],
  [Prayer.PIETY, { name: 'Piety', imageUrl: '/images/prayers/piety.webp' }],
  [Prayer.RIGOUR, { name: 'Rigour', imageUrl: '/images/prayers/rigour.webp' }],
  [Prayer.AUGURY, { name: 'Augury', imageUrl: '/images/prayers/augury.png' }],
];

export default function KeyPrayers({ prayerSet: raw }: KeyPrayersProps) {
  const prayers = PrayerSet.fromRaw(raw);

  return (
    <div className={styles.keyPrayers}>
      {KEY_PRAYERS.map(([prayer, { name, imageUrl }]) => (
        <div
          key={prayer}
          className={`${styles.prayer}${prayers.has(prayer) ? ` ${styles.active}` : ''}`}
        >
          <div className={styles.wrapper}>
            <Image
              src={imageUrl}
              alt={prayers.has(prayer) ? `${name} (Active)` : name}
              fill
              style={{ objectFit: 'contain' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
