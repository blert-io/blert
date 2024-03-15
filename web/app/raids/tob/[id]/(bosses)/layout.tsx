'use client';

import { useContext } from 'react';
import { useRouter } from 'next/navigation';

import { DisplayContext } from '../../../../display';

import styles from './style.module.scss';

type BossLayoutProps = {
  children: React.ReactNode;
};

export default function BossLayout({ children }: BossLayoutProps) {
  const display = useContext(DisplayContext);
  const router = useRouter();

  return (
    <div className={styles.bossPage}>
      {display.isCompact() ? (
        <div style={{ textAlign: 'center', fontSize: 24, marginTop: 50 }}>
          <p>Mobile raid view coming soon</p>
          <button
            onClick={() => router.back()}
            style={{
              fontSize: 20,
              border: '1px solid #ffffff30',
              borderRadius: 5,
              padding: '5px 10px',
            }}
          >
            Return
          </button>
        </div>
      ) : (
        <div className={styles.inner}>{children}</div>
      )}
    </div>
  );
}
