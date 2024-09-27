import { DataSource, Prayer, PrayerSet, RawPrayerSet } from '@blert/common';
import Image from 'next/image';

import styles from './style.module.scss';

type KeyPrayersProps = {
  combatOnly?: boolean;
  prayerSet: RawPrayerSet;
  source?: DataSource;
};

type PrayerDescriptor = { name: string; imageUrl: string; combat: boolean };

const KEY_PRAYERS: [Prayer, PrayerDescriptor][] = [
  [
    Prayer.PROTECT_FROM_MAGIC,
    {
      name: 'Protect from Magic',
      imageUrl: '/images/prayers/protect-from-magic.webp',
      combat: false,
    },
  ],
  [
    Prayer.PROTECT_FROM_MISSILES,
    {
      name: 'Protect from Missiles',
      imageUrl: '/images/prayers/protect-from-missiles.webp',
      combat: false,
    },
  ],
  [
    Prayer.PROTECT_FROM_MELEE,
    {
      name: 'Protect from Melee',
      imageUrl: '/images/prayers/protect-from-melee.webp',
      combat: false,
    },
  ],
  [
    Prayer.PIETY,
    { name: 'Piety', imageUrl: '/images/prayers/piety.webp', combat: true },
  ],
  [
    Prayer.RIGOUR,
    { name: 'Rigour', imageUrl: '/images/prayers/rigour.webp', combat: true },
  ],
  [
    Prayer.AUGURY,
    { name: 'Augury', imageUrl: '/images/prayers/augury.png', combat: true },
  ],
];

export default function KeyPrayers({
  combatOnly = false,
  prayerSet: raw,
  source = DataSource.SECONDARY,
}: KeyPrayersProps) {
  const prayers = PrayerSet.fromRaw(raw);

  return (
    <div className={styles.keyPrayers}>
      {KEY_PRAYERS.map(([prayer, { name, imageUrl, combat }]) => {
        if (combatOnly && !combat) {
          return null;
        }

        return (
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
        );
      })}
      {source === DataSource.SECONDARY && (
        <div className={styles.secondary}>No data</div>
      )}
    </div>
  );
}
