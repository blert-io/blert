'use client';

import React, { useContext, useEffect, useState } from 'react';

import { DisplayContext, NavbarContext } from '../../display';
import { clamp } from '../../utils/math';

import { LEFT_NAV_WIDTH } from './definitions';

import styles from './styles.module.scss';
import { usePathname } from 'next/navigation';

const enum ScrollDirection {
  VERTICAL,
  HORIZONTAL,
}

type TouchInfo = {
  touch: Touch;
  direction: ScrollDirection | null;
};

export function LeftNavWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const display = useContext(DisplayContext);
  const { sidebarOpen, setSidebarOpen } = useContext(NavbarContext);

  const [dragX, setDragX] = useState(0);

  const activeTouch = React.useRef<TouchInfo | null>(null);

  useEffect(() => {
    setSidebarOpen(display.isFull());
  }, [display, pathname, setSidebarOpen]);

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
  }, [display, sidebarOpen, setSidebarOpen]);

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
