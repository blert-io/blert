'use client';

import { ChallengeType } from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useContext } from 'react';

import { authClient } from '@/auth-client';
import { NavbarContext, useDisplay } from '@/display';
import { useClientOnly } from '@/hooks/client-only';
import { challengeLogo, MAIN_LOGO } from '@/logo';
import ThemePicker from '@/theme/theme-picker';

import AccountStatus, { AccountStatusSkeleton } from './account-status';
import { LeftNavWrapper } from './left-nav-wrapper';
import NavPlayerSearch from './nav-player-search';

import styles from './styles.module.scss';

type ChallengeLink = {
  type: ChallengeType;
  short: string;
  label: string;
  href: string;
};

const CHALLENGES: ChallengeLink[] = [
  {
    type: ChallengeType.TOB,
    short: 'ToB',
    label: 'Theatre of Blood',
    href: '/raids/tob',
  },
  {
    type: ChallengeType.INFERNO,
    short: 'Inferno',
    label: 'Inferno',
    href: '/challenges/inferno',
  },
  {
    type: ChallengeType.COLOSSEUM,
    short: 'Colo',
    label: 'Fortis Colosseum',
    href: '/challenges/colosseum',
  },
  {
    type: ChallengeType.MOKHAIOTL,
    short: 'Doom',
    label: 'Mokhaiotl',
    href: '/challenges/mokhaiotl',
  },
  {
    type: ChallengeType.TOA,
    short: 'ToA',
    label: 'Tombs of Amascut',
    href: '/raids/toa',
  },
  {
    type: ChallengeType.COX,
    short: 'CoX',
    label: 'Chambers of Xeric',
    href: '/raids/cox',
  },
];

type UtilLink = {
  icon: string;
  label: string;
  href: string;
  /** Path prefix that counts as active; defaults to `href`. */
  match?: string;
};

const UTIL_LINKS: UtilLink[] = [
  {
    icon: 'fa-solid fa-trophy',
    label: 'Leaderboards',
    href: '/leaderboards/tob',
    match: '/leaderboards',
  },
  { icon: 'fa-solid fa-arrow-trend-up', label: 'Trends', href: '/trends' },
  { icon: 'fa-solid fa-shield-halved', label: 'Gear Setups', href: '/setups' },
  { icon: 'fa-solid fa-book', label: 'Guides', href: '/guides' },
  { icon: 'fa-solid fa-pencil', label: 'Name Changes', href: '/name-changes' },
];

function isUnder(pathname: string, base: string): boolean {
  if (base === '/') {
    return pathname === '/';
  }
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function LeftNav() {
  const { data: session } = authClient.useSession();
  const isMounted = useClientOnly();
  const isLoggedIn = isMounted && !!session?.user;

  const display = useDisplay();
  const pathname = usePathname();
  const { sidebarCollapsed: collapsed, setSidebarCollapsed: setCollapsed } =
    useContext(NavbarContext);

  return (
    <LeftNavWrapper>
      <nav className={`${styles.nav} ${collapsed ? styles.collapsed : ''}`}>
        <div className={styles.header}>
          <Link className={styles.logo} href="/home" aria-label="Home">
            <Image
              src={MAIN_LOGO}
              alt="Blert"
              fill
              sizes="150px"
              style={{ objectFit: 'contain' }}
            />
          </Link>
          {display.isFull() && (
            <button
              className={styles.collapseButton}
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <i className={`fas fa-chevron-${collapsed ? 'right' : 'left'}`} />
            </button>
          )}
        </div>

        {collapsed ? (
          <button
            className={styles.item}
            onClick={() => {
              setCollapsed(false);
              // Focus the search input when the it mounts.
              requestAnimationFrame(() =>
                document.getElementById('blert-player-search')?.focus(),
              );
            }}
            title="Find a player"
            aria-label="Find a player"
          >
            <span className={styles.itemIcon}>
              <i className="fa-solid fa-magnifying-glass" />
            </span>
          </button>
        ) : (
          <div className={styles.search}>
            <NavPlayerSearch />
          </div>
        )}

        {isLoggedIn && (
          <Link
            className={`${styles.item} ${isUnder(pathname, '/') ? styles.active : ''}`}
            href="/"
          >
            <span className={styles.itemIcon}>
              <i className="fa-solid fa-newspaper" />
            </span>
            <span className={styles.itemLabel}>Dashboard</span>
          </Link>
        )}

        <div className={styles.divider} />

        <div className={styles.grid}>
          {CHALLENGES.map((challenge) => (
            <Link
              key={challenge.type}
              className={`${styles.tile} ${isUnder(pathname, challenge.href) ? styles.active : ''}`}
              href={challenge.href}
              title={challenge.label}
            >
              <span className={styles.tileIcon}>
                <Image
                  src={challengeLogo(challenge.type)}
                  alt={challenge.label}
                  fill
                  style={{ objectFit: 'contain' }}
                />
              </span>
              <span className={styles.tileLabel}>{challenge.short}</span>
            </Link>
          ))}
          <Link
            className={`${styles.browse} ${isUnder(pathname, '/search/challenges') ? styles.active : ''}`}
            href="/search/challenges"
            title="Browse runs"
          >
            <span>Browse runs</span>
            <i className="fa-solid fa-arrow-right" />
          </Link>
        </div>

        <div className={styles.divider} />

        <div>
          {UTIL_LINKS.map((link) => (
            <Link
              key={link.href}
              className={`${styles.item} ${isUnder(pathname, link.match ?? link.href) ? styles.active : ''}`}
              href={link.href}
            >
              <span className={styles.itemIcon}>
                <i className={link.icon} />
              </span>
              <span className={styles.itemLabel}>{link.label}</span>
            </Link>
          ))}
        </div>

        {collapsed ? (
          <div className={styles.collapsedFooter}>
            <Suspense fallback={<AccountStatusSkeleton variant="mini" />}>
              <AccountStatus variant="mini" />
            </Suspense>
            <ThemePicker variant="mini" />
          </div>
        ) : (
          <>
            <Suspense fallback={<AccountStatusSkeleton />}>
              <AccountStatus />
            </Suspense>

            <div className={styles.strip}>
              <ThemePicker />
              <div className={styles.socials}>
                <Link
                  className={styles.socialButton}
                  href="https://discord.gg/c5Hgv3NnYe"
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Discord"
                >
                  <i className="fa-brands fa-discord" />
                </Link>
                <Link
                  className={styles.socialButton}
                  href="https://patreon.com/blert"
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Patreon"
                >
                  <i className="fa-brands fa-patreon" />
                </Link>
                <Link
                  className={styles.socialButton}
                  href="https://github.com/blert-io"
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="GitHub"
                >
                  <i className="fa-brands fa-github" />
                </Link>
              </div>
            </div>
          </>
        )}
      </nav>
    </LeftNavWrapper>
  );
}
