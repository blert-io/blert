'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useDisplay } from '@/display';

import styles from './style.module.scss';

const blertcoinEnabled = process.env.NEXT_PUBLIC_BLERTCOIN_ENABLED === 'true';

const tabs = [
  { href: '/settings/account', label: 'Account', icon: 'fas fa-user' },
  { href: '/settings/following', label: 'Following', icon: 'fas fa-users' },
  blertcoinEnabled && {
    href: '/settings/blertcoin',
    label: 'Blertcoin',
    icon: 'fas fa-coins',
  },
  { href: '/settings/api-keys', label: 'API Keys', icon: 'fas fa-key' },
  {
    href: '/settings/linked-accounts',
    label: 'Linked Accounts',
    icon: 'fas fa-link',
  },
].filter(Boolean) as { href: string; label: string; icon: string }[];

export default function SettingsTabs() {
  const pathname = usePathname();
  const display = useDisplay();

  return (
    <div className={styles.tabs}>
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={styles.tab}
          aria-current={pathname === tab.href ? 'page' : undefined}
        >
          <i className={tab.icon} />
          <span className={display.isCompact() ? 'sr-only' : ''}>
            {tab.label}
          </span>
        </Link>
      ))}
    </div>
  );
}
