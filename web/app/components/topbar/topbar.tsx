'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useContext } from 'react';

import { DisplayContext, NavbarContext } from '@/display';
import { MAIN_LOGO } from '@/logo';

import styles from './style.module.scss';

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
      <Link className={styles.image} href="/">
        <Image
          src={MAIN_LOGO}
          alt="Blert"
          fill
          style={{ objectFit: 'contain' }}
        />
      </Link>
      <div className={styles.placeholder} />
    </div>
  );
}
