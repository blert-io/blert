import { DataSource, Prayer, PrayerSet, RawPrayerSet } from '@blert/common';
import Image from 'next/image';

import styles from './style.module.scss';

type KeyPrayersProps = {
  combatOnly?: boolean;
  prayerSet: RawPrayerSet;
  source?: DataSource;
  size?: number;
  hasZeal: boolean;
};

type PrayerDescriptor = { name: string; icon: string; combat: boolean };

const KEY_PRAYERS: [Prayer, PrayerDescriptor][] = [
  [
    Prayer.PROTECT_FROM_MAGIC,
    { name: 'Protect from Magic', icon: 'protect-from-magic', combat: false },
  ],
  [
    Prayer.PROTECT_FROM_MISSILES,
    {
      name: 'Protect from Missiles',
      icon: 'protect-from-missiles',
      combat: false,
    },
  ],
  [
    Prayer.PROTECT_FROM_MELEE,
    { name: 'Protect from Melee', icon: 'protect-from-melee', combat: false },
  ],
  [Prayer.PIETY, { name: 'Piety', icon: 'piety', combat: true }],
  [Prayer.RIGOUR, { name: 'Rigour', icon: 'rigour', combat: true }],
  [Prayer.AUGURY, { name: 'Augury', icon: 'augury', combat: true }],
];

const ZEAL: [Prayer, PrayerDescriptor] = [
  Prayer.ZEAL,
  { name: 'Zeal', icon: 'zeal', combat: true },
];

const DEFAULT_PRAYER_SIZE = 32;
const ACTIVE_BACKGROUND_SCALE = 34 / 30;

export default function KeyPrayers({
  combatOnly = false,
  prayerSet: raw,
  size = DEFAULT_PRAYER_SIZE,
  source = DataSource.SECONDARY,
  hasZeal,
}: KeyPrayersProps) {
  const prayers = PrayerSet.fromRaw(raw);

  const blockSize = size + 8;
  const backgroundSize = size * ACTIVE_BACKGROUND_SCALE;
  const width = 3 * blockSize + 10;

  return (
    <div className={styles.keyPrayers} style={{ width }}>
      {KEY_PRAYERS.map((keyPrayer) => {
        const [prayer, { name, icon, combat }] =
          hasZeal && keyPrayer[0] === Prayer.PIETY ? ZEAL : keyPrayer;
        if (combatOnly && !combat) {
          return null;
        }

        const active = prayers.has(prayer);
        return (
          <div
            key={prayer}
            className={styles.prayer}
            style={{ height: blockSize, width: size + 8 }}
          >
            {active && (
              <div
                className={styles.background}
                style={{ height: backgroundSize, width: backgroundSize }}
              >
                <Image
                  src="/images/prayers/active-background.png"
                  alt=""
                  fill
                />
              </div>
            )}
            <div
              className={styles.wrapper}
              style={{ height: size, width: size }}
            >
              <Image
                src={
                  active
                    ? `/images/prayers/${icon}.png`
                    : `/images/prayers/${icon}-disabled.png`
                }
                alt={active ? `${name} (Active)` : name}
                fill
                style={{ objectFit: 'contain' }}
              />
            </div>
          </div>
        );
      })}
      {source === DataSource.SECONDARY && (
        <div className={styles.secondary} style={{ height: blockSize + 4 }}>
          No data
        </div>
      )}
    </div>
  );
}
