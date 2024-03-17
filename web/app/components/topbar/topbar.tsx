'use client';

import { useContext } from 'react';

import { DisplayContext, NavbarContext } from '../../display';

import styles from './style.module.scss';
import Image from 'next/image';

export default function Topbar() {
  const display = useContext(DisplayContext);
  const { setSidebarOpen } = useContext(NavbarContext);

  if (display.isFull()) {
    return null;
  }

  return (
    <div className={styles.topbar}>
      <button className={styles.menu} onClick={() => setSidebarOpen(true)}>
        <span className="fa-solid fa-bars"></span>
      </button>
      <div className={styles.image}>
        <Image
          src="/blert-topbar.png"
          alt="Blert"
          fill
          style={{ objectFit: 'contain' }}
        />
      </div>
      <div className={styles.placeholder} />
    </div>
  );
}
