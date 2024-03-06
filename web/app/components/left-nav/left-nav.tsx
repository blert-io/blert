'use client';

import Image from 'next/image';

import Link from 'next/link';

import playerImg from '/public/player.png';

import styles from './styles.module.scss';

import { usePathname } from 'next/navigation';

export function LeftNav() {
  const currentPath = usePathname();

  // viewingTob is determined by if the current path matches the following: /raids/tob/{a guid}
  const viewingTob = currentPath.match(/\/raids\/tob\/[a-zA-Z0-9-]+/);

  // now grab just that portion of the path into a new string
  const currentPathForRaid = currentPath.split('/').slice(0, 4).join('/');

  return (
    <div className={styles.leftNav}>
      <div className={styles.leftNav__logo}>
        <Link
          href="/"
          style={{ width: '200px', position: 'relative', height: '150px' }}
        >
          <Image
            src="/blert-topbar.png"
            alt="blert logo"
            fill
            style={{ objectFit: 'contain' }}
          />
        </Link>
      </div>

      <ul className={styles.leftNav__menu}>
        {/* Home */}
        <li className={styles.leftNav__menuItem}>
          <Link className={`${styles.leftNav__menuItemInner}`} href="/raids">
            <div
              className={styles.leftNav__menuItemIcon}
              style={{
                width: '40px',
                position: 'relative',
                height: '40px',
              }}
            >
              <Image
                src="/home.webp"
                alt="home icon"
                fill
                style={{ objectFit: 'contain' }}
              />
            </div>

            <span className="active">Home</span>
          </Link>
        </li>

        {/* Search */}
        <li className={styles.leftNav__menuItem}>
          <Link className={`${styles.leftNav__menuItemInner}`} href="/raids">
            <div className={styles.leftNav__menuItemIcon}>
              <i className="fa-solid fa-magnifying-glass"></i>
            </div>

            <span className="active">Search</span>
          </Link>
        </li>

        <div className={styles.leftNav__menuDivider}></div>

        {/* ToB */}
        <li className={styles.leftNav__menuItem}>
          <Link
            className={`${styles.leftNav__menuItemInner} ${viewingTob && styles.leftNav__menuItemInnerActive}`}
            href="/raids/tob"
          >
            <div
              className={styles.leftNav__menuItemIcon}
              style={{
                width: '40px',
                position: 'relative',
                height: '40px',
              }}
            >
              <Image
                src="/logo_tob.webp"
                alt="tob icon"
                fill
                style={{ objectFit: 'contain' }}
              />
            </div>
            <span className="active">ToB</span>
          </Link>
        </li>

        {viewingTob && (
          <li className={styles.leftNav__subMenu}>
            <Link href={currentPathForRaid + '/overview'}>
              <div
                className={`${styles.leftNav__subMenuItem} ${currentPath.includes('/overview') && styles.leftNav__subMenuItemActive}`}
              >
                Overview
              </div>
            </Link>
            <Link href={currentPathForRaid + '/maiden'}>
              <div
                className={`${styles.leftNav__subMenuItem} ${currentPath.includes('/maiden') && styles.leftNav__subMenuItemActive}`}
              >
                Maiden
              </div>
            </Link>
            <Link href={currentPathForRaid + '/bloat'}>
              <div
                className={`${styles.leftNav__subMenuItem} ${currentPath.includes('/bloat') && styles.leftNav__subMenuItemActive}`}
              >
                Blert
              </div>
            </Link>
            <Link href={currentPathForRaid + '/nylocas'}>
              <div
                className={`${styles.leftNav__subMenuItem} ${currentPath.includes('/nylocas') && styles.leftNav__subMenuItemActive}`}
              >
                Nylocas
              </div>
            </Link>
            <Link href={currentPathForRaid + '/sotetseg'}>
              <div
                className={`${styles.leftNav__subMenuItem} ${currentPath.includes('/sotetseg') && styles.leftNav__subMenuItemActive}`}
              >
                Sotetseg
              </div>
            </Link>
            <Link href={currentPathForRaid + '/xarpus'}>
              <div
                className={`${styles.leftNav__subMenuItem} ${currentPath.includes('/xarpus') && styles.leftNav__subMenuItemActive}`}
              >
                Xarpus
              </div>
            </Link>
            <Link href={currentPathForRaid + '/verzik'}>
              <div
                className={`${styles.leftNav__subMenuItem} ${currentPath.includes('/verzik') && styles.leftNav__subMenuItemActive}`}
              >
                Verzik
              </div>
            </Link>
          </li>
        )}

        {/* CoX */}
        <li className={styles.leftNav__menuItem}>
          <Link
            className={`${styles.leftNav__menuItemInner}`}
            href="/raids/cox"
          >
            <div
              className={styles.leftNav__menuItemIcon}
              style={{
                width: '40px',
                position: 'relative',
                height: '40px',
              }}
            >
              <Image
                src="/logo_cox.webp"
                alt="cox icon"
                fill
                style={{ objectFit: 'contain' }}
              />
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
            <div
              className={styles.leftNav__menuItemIcon}
              style={{
                width: '40px',
                position: 'relative',
                height: '40px',
              }}
            >
              <Image
                src="/logo_toa.webp"
                alt="toa icon"
                fill
                style={{ objectFit: 'contain' }}
              />
            </div>
            <span className="active">ToA</span>
          </Link>
        </li>

        <div className={styles.leftNav__menuDividerTwo}></div>

        {/* Trends */}
        <li className={styles.leftNav__menuItem}>
          <Link className={`${styles.leftNav__menuItemInner}`} href="/trends">
            <div className={styles.leftNav__menuItemIcon}>
              <i className="fa-solid fa-arrow-trend-up"></i>
            </div>

            <span className="active">Trends</span>
          </Link>
        </li>

        {/* Account */}
        <li className={styles.leftNav__menuItem}>
          <Link className={`${styles.leftNav__menuItemInner}`} href="/account">
            <div className={styles.leftNav__menuItemIcon}>
              <i className="fa-solid fa-user-ninja"></i>
            </div>

            <span className="active">Account</span>
          </Link>
        </li>
      </ul>

      <div className={styles.leftNav__externalLinks}>
        <div className={styles.leftNav__externalLink}>
          <Link
            href="https://discord.gg/yWD6KGuG"
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
  );
}
