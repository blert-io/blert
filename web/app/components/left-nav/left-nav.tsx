'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Suspense, useContext } from 'react';

import { MAIN_LOGO } from '@/logo';
import { NavbarContext } from '@/display';

import AccountStatus, { AccountStatusSkeleton } from './account-status';
import { LEFT_NAV_WIDTH } from './definitions';
import { LeftNavWrapper } from './left-nav-wrapper';
import NavPlayerSearch from './nav-player-search';

import styles from './styles.module.scss';

export function LeftNav() {
  const { sidebarCollapsed: collapsed, setSidebarCollapsed: setCollapsed } = useContext(NavbarContext);

  return (
    <LeftNavWrapper collapsed={collapsed}>
      <div
        className={`${styles.leftNav} ${collapsed ? styles.collapsed : ''}`}
        style={{ width: collapsed ? 60 : LEFT_NAV_WIDTH }}
      >
        <button
          className={styles.collapseToggle}
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <i className={`fas fa-chevron-${collapsed ? 'right' : 'left'}`} />
        </button>

        <div className={styles.leftNav__logo}>
          <Link className={styles.homeImage} href="/">
            <Image
              src={MAIN_LOGO}
              alt="Blert logo"
              fill
              sizes="150px"
              style={{ objectFit: 'contain' }}
            />
          </Link>
        </div>

        <ul className={styles.leftNav__menu}>
          {/* Home */}
          <li className={styles.leftNav__menuItem}>
            <Link className={styles.leftNav__menuItemInner} href="/">
              <div className={styles.leftNav__menuItemIcon}>
                <div className={styles.imageWrapper}>
                  <Image
                    src="/home.webp"
                    alt="home icon"
                    fill
                    style={{ objectFit: 'contain' }}
                  />
                </div>
              </div>

              <span className="active" style={{ top: 1 }}>
                Home
              </span>
            </Link>
          </li>

          <li className={styles.leftNav__playerSearch}>
            <NavPlayerSearch />
          </li>

          <div className={styles.leftNav__menuDivider}></div>

          <li className={styles.leftNav__menuItem}>
            <Link className={styles.leftNav__menuItemInner} href="/raids/tob">
              <div className={styles.leftNav__menuItemIcon}>
                <div className={styles.imageWrapper}>
                  <Image
                    src="/logo_tob.webp"
                    alt="tob icon"
                    fill
                    style={{ objectFit: 'contain' }}
                  />
                </div>
              </div>
              <span className="active">ToB</span>
            </Link>
          </li>
          <li className={styles.leftNav__menuItem}>
            <Link
              className={styles.leftNav__menuItemInner}
              href="/challenges/inferno"
            >
              <div className={styles.leftNav__menuItemIcon}>
                <div className={styles.imageWrapper}>
                  <Image
                    src="/inferno.png"
                    alt="Inferno icon"
                    fill
                    style={{ objectFit: 'contain' }}
                  />
                </div>
              </div>
              <span className="active">Inferno</span>
            </Link>
          </li>
          <li className={styles.leftNav__menuItem}>
            <Link
              className={styles.leftNav__menuItemInner}
              href="/challenges/colosseum"
            >
              <div className={styles.leftNav__menuItemIcon}>
                <div className={styles.imageWrapper}>
                  <Image
                    src="/varlamore.png"
                    alt="fortis colosseum icon"
                    fill
                    style={{ objectFit: 'contain' }}
                  />
                </div>
              </div>
              <span className="active" style={{ top: -1 }}>
                Colosseum
              </span>
            </Link>
          </li>

          {/* Mokhaiotl */}
          <li className={styles.leftNav__menuItem}>
            <Link
              className={styles.leftNav__menuItemInner}
              href="/challenges/mokhaiotl"
            >
              <div className={styles.leftNav__menuItemIcon}>
                <div className={styles.imageWrapper}>
                  <Image
                    src="/images/mokhaiotl.webp"
                    alt="Mokhaiotl icon"
                    fill
                    style={{ objectFit: 'contain' }}
                  />
                </div>
              </div>
              <span className="active" style={{ top: -1 }}>
                Mokhaiotl
              </span>
            </Link>
          </li>

          {/* ToA */}
          <li className={styles.leftNav__menuItem}>
            <Link className={styles.leftNav__menuItemInner} href="/raids/toa">
              <div className={styles.leftNav__menuItemIcon}>
                <div className={styles.imageWrapper}>
                  <Image
                    src="/logo_toa.webp"
                    alt="toa icon"
                    fill
                    style={{ objectFit: 'contain' }}
                  />
                </div>
              </div>
              <span className="active" style={{ top: -1 }}>
                ToA
              </span>
            </Link>
          </li>

          {/* Search */}
          <li className={styles.leftNav__menuItem}>
            <Link className={styles.leftNav__menuItemInner} href="/search">
              <div className={styles.leftNav__menuItemIcon}>
                <i className="fa-solid fa-magnifying-glass"></i>
              </div>

              <span className="active">Search</span>
            </Link>
          </li>

          <div className={styles.leftNav__menuDividerTwo}></div>

          {/* Leaderboards */}
          <li className={styles.leftNav__menuItem}>
            <Link
              className={styles.leftNav__menuItemInner}
              href="/leaderboards/tob"
            >
              <div className={styles.leftNav__menuItemIcon}>
                <i className="fa-solid fa-trophy"></i>
              </div>

              <span className="active" style={{ top: -1 }}>
                Leaderboards
              </span>
            </Link>
          </li>

          {/* Trends */}
          <li className={styles.leftNav__menuItem}>
            <Link className={styles.leftNav__menuItemInner} href="/trends">
              <div className={styles.leftNav__menuItemIcon}>
                <i className="fa-solid fa-arrow-trend-up"></i>
              </div>

              <span className="active" style={{ top: -1 }}>
                Trends
              </span>
            </Link>
          </li>

          {/* Setups */}
          <li className={styles.leftNav__menuItem}>
            <Link className={styles.leftNav__menuItemInner} href="/setups">
              <div className={styles.leftNav__menuItemIcon}>
                <i className="fas fa-shield-halved"></i>
              </div>
              <span className="active">Gear Setups</span>
            </Link>
          </li>

          {/* Guides */}
          <li className={styles.leftNav__menuItem}>
            <Link className={styles.leftNav__menuItemInner} href="/guides">
              <div className={styles.leftNav__menuItemIcon}>
                <i className="fa-solid fa-book"></i>
              </div>

              <span className="active">Guides</span>
            </Link>
          </li>

          {/* Name changes */}
          <li className={styles.leftNav__menuItem}>
            <Link
              className={styles.leftNav__menuItemInner}
              href="/name-changes"
            >
              <div className={styles.leftNav__menuItemIcon}>
                <i className="fa-solid fa-pencil" />
              </div>

              <span className="active">Name Changes</span>
            </Link>
          </li>
        </ul>

        <Suspense fallback={<AccountStatusSkeleton />}>
          <AccountStatus />
        </Suspense>

        <div className={styles.leftNav__externalLinks}>
          <div className={styles.leftNav__externalLink}>
            <Link
              href="https://discord.gg/c5Hgv3NnYe"
              target="_blank"
              rel="noreferrer noopener"
            >
              <i className="fa-brands fa-discord"></i>
            </Link>
          </div>
          <div className={styles.leftNav__externalLink}>
            <Link
              href="https://github.com/blert-io"
              target="_blank"
              rel="noreferrer noopener"
            >
              <i className="fa-brands fa-github"></i>
            </Link>
          </div>
        </div>
      </div>
    </LeftNavWrapper>
  );
}
