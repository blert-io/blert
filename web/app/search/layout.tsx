'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import Card from '@/components/card';

import styles from './layout.module.scss';

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const isChallenge = pathname === '/search/challenges';
  const isSession = pathname === '/search/sessions';

  return (
    <div className={styles.searchLayout}>
      <Card className={styles.header} fixed primary>
        <h1>Search</h1>
        <p>
          Find recorded challenges and sessions by player, date, and other
          criteria.
        </p>
        <nav className={styles.tabs}>
          <Link
            href="/search/challenges"
            className={`${styles.tab} ${isChallenge ? styles.active : ''}`}
          >
            <i className="fas fa-list" />
            Challenges
          </Link>
          <Link
            href="/search/sessions"
            className={`${styles.tab} ${isSession ? styles.active : ''}`}
          >
            <i className="fas fa-layer-group" />
            Sessions
          </Link>
        </nav>
      </Card>
      {children}
    </div>
  );
}
