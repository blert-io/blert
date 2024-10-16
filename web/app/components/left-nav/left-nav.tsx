import Image from 'next/image';
import Link from 'next/link';

import { MAIN_LOGO } from '@/logo';

import { LEFT_NAV_WIDTH } from './definitions';
import { LeftNavWrapper } from './left-nav-wrapper';
import AccountStatus from './account-status';
import PlayerSearch from './player-search';
import ColosseumLinks from './colosseum-links';
import TobLinks from './tob-links';

import styles from './styles.module.scss';

export function LeftNav() {
  return (
    <LeftNavWrapper>
      <div className={styles.leftNav} style={{ width: LEFT_NAV_WIDTH }}>
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
            <Link className={`${styles.leftNav__menuItemInner}`} href="/">
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
            <PlayerSearch />
          </li>

          <div className={styles.leftNav__menuDivider}></div>

          <TobLinks />
          <ColosseumLinks />

          {/* Inferno */}
          <li className={styles.leftNav__menuItem}>
            <Link
              className={`${styles.leftNav__menuItemInner}`}
              href="/challenges/inferno"
            >
              <div className={styles.leftNav__menuItemIcon}>
                <div className={styles.imageWrapper}>
                  <Image
                    src="/inferno.png"
                    alt="fortis inferno icon"
                    fill
                    style={{ objectFit: 'contain' }}
                  />
                </div>
              </div>
              <span className="active">Inferno</span>
            </Link>
          </li>

          {/* CoX */}
          <li className={styles.leftNav__menuItem}>
            <Link
              className={`${styles.leftNav__menuItemInner}`}
              href="/raids/cox"
            >
              <div className={styles.leftNav__menuItemIcon}>
                <div className={styles.imageWrapper}>
                  <Image
                    src="/logo_cox.webp"
                    alt="cox icon"
                    fill
                    style={{ objectFit: 'contain' }}
                  />
                </div>
              </div>
              <span className="active">CoX</span>
            </Link>
          </li>

          {/* ToA */}
          <li className={styles.leftNav__menuItem}>
            <Link
              className={`${styles.leftNav__menuItemInner}`}
              href="/raids/toa"
            >
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
            <Link className={`${styles.leftNav__menuItemInner}`} href="/search">
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
              className={`${styles.leftNav__menuItemInner}`}
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
            <Link className={`${styles.leftNav__menuItemInner}`} href="/trends">
              <div className={styles.leftNav__menuItemIcon}>
                <i className="fa-solid fa-arrow-trend-up"></i>
              </div>

              <span className="active" style={{ top: -1 }}>
                Trends
              </span>
            </Link>
          </li>

          {/* Guides */}
          <li className={styles.leftNav__menuItem}>
            <Link className={`${styles.leftNav__menuItemInner}`} href="/guides">
              <div className={styles.leftNav__menuItemIcon}>
                <i className="fa-solid fa-book"></i>
              </div>

              <span className="active">Guides</span>
            </Link>
          </li>

          {/* Name changes */}
          <li className={styles.leftNav__menuItem}>
            <Link
              className={`${styles.leftNav__menuItemInner}`}
              href="/name-changes"
            >
              <div className={styles.leftNav__menuItemIcon}>
                <i className="fa-solid fa-pencil" />
              </div>

              <span className="active">Name Changes</span>
            </Link>
          </li>

          {/* Account */}
          {/* <li className={styles.leftNav__menuItem}>
          <Link className={`${styles.leftNav__menuItemInner}`} href="/account">
            <div className={styles.leftNav__menuItemIcon}>
              <i className="fa-solid fa-user-ninja"></i>
            </div>

            <span className="active">Account</span>
          </Link>
        </li> */}
        </ul>

        <AccountStatus />

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
