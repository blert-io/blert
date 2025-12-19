'use client';

import { usePathname } from 'next/navigation';
import React, { useContext, useEffect, useState } from 'react';

import { NavbarContext, useDisplay } from '@/display';
import { clamp } from '@/utils/math';

import { LEFT_NAV_WIDTH } from './definitions';

import styles from './styles.module.scss';

const enum ScrollDirection {
  VERTICAL,
  HORIZONTAL,
}

type TouchInfo = {
  touch: Touch;
  direction: ScrollDirection | null;
};

/** Delay after a touch end event to prevent the sidebar from being closed. */
const TOUCH_END_DELAY_MS = 100;

/**
 * Determines whether starting a drag on the target element should prevent
 * the sidebar from being opened.
 *
 * @param target Element to inspect.
 * @returns True if the element should not allow the sidebar to be opened.
 */
function shouldSuppressSidebarDrag(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  // Certain types of inputs are draggable. In text inputs, the user may
  // want to select text. Don't allow the sidebar to be opened while
  // interacting with these elements.
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'CANVAS'
  ) {
    return true;
  }

  // If the target element is located within a horizontally scrollable
  // container, suppress the sidebar drag.
  let element: HTMLElement | null = target;
  while (element) {
    if (element.scrollWidth > element.clientWidth + 10) {
      return true;
    }

    // Custom attribute elements can set to prevent the sidebar from being
    // opened while interacting with them.
    if (element.dataset.blertDisableSidebar === 'true') {
      return true;
    }

    element = element.parentElement;
  }
  return false;
}

const SCREEN_EDGE_THRESHOLD = 50;

export function LeftNavWrapper({
  children,
  collapsed,
}: {
  children: React.ReactNode;
  collapsed: boolean;
}) {
  const pathname = usePathname();

  const display = useDisplay();
  const { sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed } =
    useContext(NavbarContext);

  const [dragX, setDragX] = useState(0);
  const [mounted, setMounted] = useState(false);

  const activeTouch = React.useRef<TouchInfo | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const lastTouchEnd = React.useRef<number>(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setSidebarOpen(display.isFull());
    if (display.isCompact() && sidebarCollapsed) {
      setSidebarCollapsed(false);
    }
  }, [
    display,
    pathname,
    setSidebarOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
  ]);

  useEffect(() => {
    // Close sidebar when clicking outside on compact displays.
    if (!display.isCompact() || !sidebarOpen) {
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      // Ignore mouse events that occur shortly after a touch event to avoid
      // closing the sidebar when the user drags it open then releases.
      if (Date.now() - lastTouchEnd.current < TOUCH_END_DELAY_MS) {
        return;
      }
      if (
        wrapperRef.current !== null &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setSidebarOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [display, sidebarOpen, setSidebarOpen]);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        return;
      }

      if (
        !sidebarOpen &&
        shouldSuppressSidebarDrag(e.target) &&
        e.touches[0].clientX > SCREEN_EDGE_THRESHOLD
      ) {
        // If the user is touching a scrollable or otherwise interactive
        // element, don't allow the sidebar to be opened unless the touch
        // is near the edge of the screen.
        // If the sidebar is already open, allow the touch to be used to
        // close it.
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

      const threshold = LEFT_NAV_WIDTH / 2 - 40;
      const isOpen = sidebarOpen ? dx > -threshold : dx > threshold;
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
      lastTouchEnd.current = Date.now();
    };
    const onTouchCancel = (e: TouchEvent) => onTouchEnd(e);

    window.addEventListener('touchstart', onTouchStart);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchCancel);

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [display, sidebarOpen, setSidebarOpen]);

  const currentWidth = collapsed ? 60 : LEFT_NAV_WIDTH;
  let left = sidebarOpen ? 0 : -currentWidth;
  left += dragX;

  const shouldAnimate =
    mounted && display.isCompact() && activeTouch.current === null;

  const style: React.CSSProperties = {
    width: currentWidth,
    left,
    transition: shouldAnimate ? 'left 0.2s, width 0.3s' : 'width 0.3s',
  };

  const wrapperClassName = mounted
    ? styles.leftNavWrapper
    : `${styles.leftNavWrapper} ${styles.leftNavWrapperUnmounted}`;

  return (
    <div ref={wrapperRef} className={wrapperClassName} style={style}>
      {children}
    </div>
  );
}
