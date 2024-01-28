'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import styles from './style.module.css';

export default function RaidNavbar({ id }: { id: string }) {
  const pathname = usePathname();

  const linkProps = (room: string) => {
    const href = `/raid/${id}/${room}`;
    const className =
      pathname === href ? `${styles.link} ${styles.active}` : styles.link;
    return { className, href };
  };

  return (
    <div className={styles.navbar}>
      <Link {...linkProps('overview')}>Overview</Link>
      <Link {...linkProps('maiden')}>Maiden</Link>
      <Link {...linkProps('bloat')}>Bloat</Link>
      <Link {...linkProps('nylocas')}>Nylocas</Link>
      <Link {...linkProps('sotetseg')}>Sotetseg</Link>
      <Link {...linkProps('xarpus')}>Xarpus</Link>
      <Link {...linkProps('verzik')}>Verzik</Link>
    </div>
  );
}
