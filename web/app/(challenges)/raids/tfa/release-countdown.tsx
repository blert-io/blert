'use client';

import { useEffect, useState } from 'react';

import { RELEASE_TIME } from './release';

import styles from './style.module.scss';

const UNITS = [
  { label: 'Days', ms: 24 * 60 * 60 * 1000 },
  { label: 'Hours', ms: 60 * 60 * 1000 },
  { label: 'Minutes', ms: 60 * 1000 },
  { label: 'Seconds', ms: 1000 },
];

export default function ReleaseCountdown() {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (now === null) {
    return <div className={styles.placeholder} />;
  }

  if (now >= RELEASE_TIME) {
    return (
      <p className={styles.release}>
        The Fractured Archive is out. Blert recording support is in progress.
      </p>
    );
  }

  let remaining = RELEASE_TIME - now;
  const values = UNITS.map(({ ms }) => {
    const value = Math.floor(remaining / ms);
    remaining -= value * ms;
    return value;
  });

  const releaseDate = new Date(RELEASE_TIME).toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <>
      <div className={styles.countdown}>
        {UNITS.map(({ label }, i) => (
          <div key={label} className={styles.unit}>
            <span className={styles.value}>
              {i === 0 ? values[i] : String(values[i]).padStart(2, '0')}
            </span>
            <span className={styles.label}>{label}</span>
          </div>
        ))}
      </div>
      <p className={styles.release}>Releases {releaseDate}.</p>
      <p className={styles.note}>
        Blert recording support will arrive some time after release.
      </p>
    </>
  );
}
