'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import styles from './style.module.scss';

const PLAYER_TABS = [
  {
    icon: 'fa-solid fa-house',
    title: 'Overview',
    href: '',
  },
  {
    icon: 'fa-solid fa-trophy',
    title: 'Personal Bests',
    href: '/personal-bests',
  },
  {
    icon: 'fa-solid fa-chart-line',
    title: 'Statistics',
    href: '/statistics',
  },
  {
    icon: 'fa-solid fa-clock-rotate-left',
    title: 'History',
    href: '/history',
  },
] as const;

export default function Navigation({ username }: { username: string }) {
  const pathname = usePathname();
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({
    opacity: 0,
  });
  const tabsRef = useRef<Array<HTMLAnchorElement | null>>([]);
  const navRef = useRef<HTMLElement>(null);

  const currentTab = PLAYER_TABS.find((tab) => {
    const expectedPath = `/players/${encodeURIComponent(username)}${tab.href}`;
    return pathname === expectedPath;
  });

  useEffect(() => {
    const activeTabIndex = PLAYER_TABS.findIndex((tab) => tab === currentTab);
    const activeTabElement = tabsRef.current[activeTabIndex];
    const navElement = navRef.current;

    if (activeTabElement && navElement) {
      const navRect = navElement.getBoundingClientRect();
      const tabRect = activeTabElement.getBoundingClientRect();

      setIndicatorStyle({
        width: `${activeTabElement.offsetWidth}px`,
        transform: `translateX(${tabRect.left - navRect.left}px)`,
        opacity: 1,
      });
    }
  }, [currentTab]);

  return (
    <nav className={styles.navigation} ref={navRef}>
      <div className={styles.tabs}>
        {PLAYER_TABS.map((tab, index) => {
          const href = `/players/${encodeURIComponent(username)}${tab.href}`;
          const isActive = pathname === href;

          return (
            <Link
              key={tab.href}
              href={href}
              ref={(el) => {
                tabsRef.current[index] = el;
              }}
              className={`${styles.tab} ${isActive ? styles.active : ''}`}
            >
              <i className={`${tab.icon} ${styles.icon}`} />
              <span className={styles.title}>{tab.title}</span>
            </Link>
          );
        })}
      </div>
      <div className={styles.indicator} style={indicatorStyle} />
    </nav>
  );
}
