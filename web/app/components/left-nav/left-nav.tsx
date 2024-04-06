'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React, { useContext, useEffect, useState } from 'react';

import { DisplayContext, NavbarContext } from '../../display';
import { clamp } from '../../utils/math';

import styles from './styles.module.scss';

// If this is changed, also change the value in `mixins.scss`.
export const LEFT_NAV_WIDTH = 240;

const enum ScrollDirection {
  VERTICAL,
  HORIZONTAL,
}

type TouchInfo = {
  touch: Touch;
  direction: ScrollDirection | null;
};

function LeftNavWrapper({ children }: { children: React.ReactNode }) {
  const display = useContext(DisplayContext);
  const { sidebarOpen, setSidebarOpen } = useContext(NavbarContext);
  const pathname = usePathname();

  const [dragX, setDragX] = useState(0);

  const activeTouch = React.useRef<TouchInfo | null>(null);

  useEffect(() => {
    setSidebarOpen(display.isFull());
  }, [display, pathname]);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        return;
      }
      activeTouch.current = { touch: e.touches[0], direction: null };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || activeTouch.current === null) {
        return;
      }
      const touch = e.touches[0];
      const dx = touch.clientX - activeTouch.current.touch.clientX;

      if (activeTouch.current.direction === null) {
        // Use the initial motion of the touch to lock it to a specific scroll
        // direction, preventing the user from both opening the nav and
        // scrolling the page.
        const dy = touch.clientY - activeTouch.current.touch.clientY;
        if (Math.abs(dy) > 5) {
          activeTouch.current.direction = ScrollDirection.VERTICAL;
        } else if (Math.abs(dx) > 5) {
          activeTouch.current.direction = ScrollDirection.HORIZONTAL;
          document.body.style.overflow = 'hidden';
        }

        if (activeTouch.current.direction === null) {
          return;
        }
      }

      switch (activeTouch.current.direction) {
        case ScrollDirection.HORIZONTAL:
          e.preventDefault();
          break;
        case ScrollDirection.VERTICAL:
          return;
      }

      if (sidebarOpen) {
        setDragX(clamp(dx, -LEFT_NAV_WIDTH, 0));
      } else {
        setDragX(clamp(dx, 0, LEFT_NAV_WIDTH));
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length !== 1 || activeTouch.current === null) {
        return;
      }
      const dx =
        e.changedTouches[0].clientX - activeTouch.current.touch.clientX;

      const isOpen = dx > LEFT_NAV_WIDTH / 2 - 40;
      if (isOpen) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflowX = 'hidden';
        document.body.style.overflowY = 'auto';
      }

      if (activeTouch.current.direction === ScrollDirection.HORIZONTAL) {
        setSidebarOpen(isOpen);
      }
      setDragX(0);
      activeTouch.current = null;
    };
    const onTouchCancel = (e: TouchEvent) => onTouchEnd(e);

    window.addEventListener('touchstart', onTouchStart);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchCancel);

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [display, sidebarOpen]);

  let left = sidebarOpen ? 0 : -LEFT_NAV_WIDTH;
  left += dragX;

  const shouldAnimate = display.isCompact() && activeTouch.current === null;

  const style: React.CSSProperties = {
    width: LEFT_NAV_WIDTH,
    left,
    transition: shouldAnimate ? 'left 0.2s' : 'none',
  };

  return (
    <div className={styles.leftNavWrapper} style={style}>
      {children}
    </div>
  );
}

export function LeftNav() {
  const currentPath = usePathname();
  const router = useRouter();

  // viewingTob is determined by if the current path matches the following: /raids/tob/{a guid}
  const viewingTob = currentPath!.match(/\/raids\/tob\/[a-zA-Z0-9-]+/);

  // now grab just that portion of the path into a new string
  const currentPathForRaid = currentPath!.split('/').slice(0, 4).join('/');

  return (
    <LeftNavWrapper>
      <div className={styles.leftNav} style={{ width: LEFT_NAV_WIDTH }}>
        <div className={styles.leftNav__logo}>
          <Link
            href="/"
            style={{ width: '200px', position: 'relative', height: '150px' }}
          >
            <Image
              src="/images/blert-topbar.png"
              alt="blert logo"
              fill
              style={{ objectFit: 'contain' }}
            />
          </Link>
        </div>

        <ul className={styles.leftNav__menu}>
          {/* Home */}
          <li className={styles.leftNav__menuItem}>
            <Link className={`${styles.leftNav__menuItemInner}`} href="/">
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

          <li className={styles.leftNav__playerSearch}>
            <input
              type="text"
              placeholder="Search for a player"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  router.push(`/players/${e.currentTarget.value}`);
                }
              }}
            />
          </li>

          {/* Search */}
          {/* <li className={styles.leftNav__menuItem}>
          <Link className={`${styles.leftNav__menuItemInner}`} href="/raids">
            <div className={styles.leftNav__menuItemIcon}>
              <i className="fa-solid fa-magnifying-glass"></i>
            </div>

            <span className="active">Search</span>
          </Link>
        </li> */}

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
                  Bloat
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

          {/* Fortis Colosseum */}
          <li className={styles.leftNav__menuItem}>
            <Link
              className={`${styles.leftNav__menuItemInner}`}
              href="/challenges/colosseum"
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
                  src="/varlamore.png"
                  alt="fortis colosseum icon"
                  fill
                  style={{ objectFit: 'contain' }}
                />
              </div>
              <span className="active">Colosseum</span>
            </Link>
          </li>

          {/* Inferno */}
          <li className={styles.leftNav__menuItem}>
            <Link
              className={`${styles.leftNav__menuItemInner}`}
              href="/challenges/inferno"
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
                  src="/inferno.png"
                  alt="fortis inferno icon"
                  fill
                  style={{ objectFit: 'contain' }}
                />
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
          {/* <li className={styles.leftNav__menuItem}>
          <Link className={`${styles.leftNav__menuItemInner}`} href="/account">
            <div className={styles.leftNav__menuItemIcon}>
              <i className="fa-solid fa-user-ninja"></i>
            </div>

            <span className="active">Account</span>
          </Link>
        </li> */}
        </ul>

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
