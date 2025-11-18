'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import styles from './style.module.scss';

export default function SettingsTabs() {
  const pathname = usePathname();

  const tabs = [
    { href: '/settings/account', label: 'Account', icon: 'fas fa-user' },
    { href: '/settings/api-keys', label: 'API Keys', icon: 'fas fa-key' },
    {
      href: '/settings/linked-accounts',
      label: 'Linked Accounts',
      icon: 'fas fa-link',
    },
  ];

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
          <span>{tab.label}</span>
        </Link>
      ))}
    </div>
  );
}
