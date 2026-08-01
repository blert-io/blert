'use client';

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import styles from './style.module.scss';

/**
 * Sideways pointer travel, in pixels, past which a press becomes a drag rather
 * than a click.
 */
const DRAG_THRESHOLD = 5;

/**
 * Pointer speed, in pixels per millisecond, at which releasing a mouse drag
 * advances a slide instead of settling on the nearest one.
 */
const FLICK_VELOCITY = 0.4;

/**
 * Milliseconds since the last pointer movement past which a release stops
 * movement instead of flicking.
 */
const FLICK_TIMEOUT = 60;

/** Milliseconds of inactivity after which a scroll is considered done. */
const SCROLL_SETTLE_MS = 120;

/** Slide count past which the dots are replaced by a counter. */
const MAX_DOTS = 8;

/** Stages of a mouse drag. */
type DragPhase = 'idle' | 'dragging' | 'settling';

export type CarouselProps = {
  children: React.ReactNode;
  maxItemWidth?: number;
  /** The active slide for controlled carousels. */
  currentIndex?: number;
  /** The slide to start on if `currentIndex` is not set. */
  defaultIndex?: number;
  onIndexChange?: (index: number) => void;
  showDots?: boolean;
  showArrows?: boolean;
  className?: string;
  footer?: React.ReactNode;
  autoCycle?: boolean;
  cycleDuration?: number;
  /** Whether the arrows and auto-cycling wrap around at the ends. */
  loop?: boolean;
  /** Pixels of adjacent slides to reveal on either side of the active one. */
  peek?: number;
  /** Accessible name for the carousel. */
  label?: string;
};

export default function Carousel({
  children,
  maxItemWidth,
  currentIndex: controlledIndex,
  defaultIndex = 0,
  onIndexChange,
  showDots = true,
  showArrows = true,
  className,
  footer,
  autoCycle = false,
  cycleDuration = 5000,
  loop = false,
  peek = 0,
  label = 'Carousel',
}: CarouselProps) {
  const slides = Children.toArray(children);
  const count = slides.length;

  // Base the key for the carousel off the content of the slides.
  const slideKeys = slides.map((slide, i) =>
    isValidElement(slide) && slide.key !== null ? slide.key : String(i),
  );
  const slidesId = slideKeys.join('-');

  const isControlled = controlledIndex !== undefined;
  const [uncontrolledIndex, setUncontrolledIndex] = useState(defaultIndex);
  const rawIndex = isControlled ? controlledIndex : uncontrolledIndex;
  const index = count === 0 ? 0 : Math.min(Math.max(rawIndex, 0), count - 1);

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(index);
  const observedIndex = useRef(index);
  const scrolledByUs = useRef(false);
  const settleTimer = useRef<NodeJS.Timeout | null>(null);
  const cycleRemaining = useRef(cycleDuration);
  const initialized = useRef(false);

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [phase, setPhase] = useState<DragPhase>('idle');
  const [offscreen, setOffscreen] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const shouldCycle = autoCycle && !reducedMotion;

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const wrapIndex = useCallback(
    (next: number) => {
      if (count === 0) {
        return 0;
      }
      if (loop) {
        return ((next % count) + count) % count;
      }
      return Math.min(Math.max(next, 0), count - 1);
    },
    [count, loop],
  );

  // Finds the slide closest to the middle of the viewport.
  const nearestIndex = useCallback(() => {
    const list = listRef.current;
    if (list === null) {
      return indexRef.current;
    }
    const middle = list.scrollLeft + list.clientWidth / 2;
    let best = 0;
    let bestDistance = Infinity;
    Array.from(list.children).forEach((child, i) => {
      const slide = child as HTMLElement;
      const distance = Math.abs(
        slide.offsetLeft + slide.clientWidth / 2 - middle,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  }, []);

  const commitIndex = useCallback(
    (target: number) => {
      if (!isControlled) {
        setUncontrolledIndex(target);
      }
      onIndexChange?.(target);
    },
    [isControlled, onIndexChange],
  );

  const scrollTo = useCallback(
    (target: number, smooth: boolean) => {
      const list = listRef.current;
      if (list === null) {
        return;
      }
      const slide = list.children[target] as HTMLElement | undefined;
      if (slide === undefined) {
        return;
      }
      scrolledByUs.current = true;
      observedIndex.current = target;
      list.scrollTo({
        left: slide.offsetLeft - (list.clientWidth - slide.clientWidth) / 2,
        behavior: smooth && !reducedMotion ? 'smooth' : 'auto',
      });
    },
    [reducedMotion],
  );

  // Settle the active slide following a natural or programmatic scroll.
  const armSettle = useCallback(() => {
    if (settleTimer.current !== null) {
      clearTimeout(settleTimer.current);
    }
    settleTimer.current = setTimeout(() => {
      scrolledByUs.current = false;
      setPhase((current) => (current === 'settling' ? 'idle' : current));

      const active = nearestIndex();
      if (active === indexRef.current) {
        return;
      }
      if (isControlled) {
        scrollTo(indexRef.current, true);
      } else {
        commitIndex(active);
      }
    }, SCROLL_SETTLE_MS);
  }, [nearestIndex, commitIndex, scrollTo, isControlled]);

  const scrollToIndex = useCallback(
    (target: number, smooth: boolean) => {
      scrollTo(target, smooth);
      armSettle();
    },
    [scrollTo, armSettle],
  );

  // Moves the carousel to a slide.
  const goTo = useCallback(
    (next: number) => {
      const target = wrapIndex(next);
      commitIndex(target);
      scrollToIndex(target, true);
    },
    [wrapIndex, commitIndex, scrollToIndex],
  );

  // Track the visible slide from the scroll position to catch all movement.
  useEffect(() => {
    const list = listRef.current;
    if (list === null || count === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      () => {
        // Ignore any changes while a scroll is active.
        if (scrolledByUs.current) {
          return;
        }
        const active = nearestIndex();
        if (active !== indexRef.current) {
          observedIndex.current = active;
          commitIndex(active);
        }
      },
      // Trigger changes when a slide's visibility crosses half of its width.
      { root: list, threshold: 0.5 },
    );

    Array.from(list.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [slidesId, count, nearestIndex, commitIndex]);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) {
        clearTimeout(settleTimer.current);
      }
    },
    [],
  );

  // Jump to the starting slide without animating it.
  useEffect(() => {
    if (initialized.current || count === 0) {
      return;
    }
    initialized.current = true;
    scrollToIndex(index, false);
  }, [count, index, scrollToIndex]);

  // Follow the controlled index.
  useEffect(() => {
    if (!isControlled || observedIndex.current === index) {
      return;
    }
    scrollToIndex(index, true);
  }, [isControlled, index, scrollToIndex]);

  // Pull the active slide back in range when slides are removed.
  useEffect(() => {
    if (count > 0 && rawIndex > count - 1) {
      goTo(count - 1);
    }
  }, [count, rawIndex, goTo]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Stop cycling if out of view.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null || !shouldCycle) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setOffscreen(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [shouldCycle]);

  useEffect(() => {
    if (!shouldCycle) {
      return;
    }
    const onChange = () => setTabHidden(document.hidden);
    setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [shouldCycle]);

  const paused =
    hovered || focused || phase !== 'idle' || offscreen || tabHidden || stopped;

  // Runs before the timer effect so that a new slide resets the remaining time.
  useEffect(() => {
    cycleRemaining.current = cycleDuration;
  }, [index, slidesId, cycleDuration]);

  // Cycle slides on a timer.
  useEffect(() => {
    if (!shouldCycle || paused || count <= 1) {
      return;
    }
    if (!loop && index >= count - 1) {
      return;
    }
    const startedAt = Date.now();
    const remaining = cycleRemaining.current;
    const timer = setTimeout(() => goTo(index + 1), remaining);
    return () => {
      clearTimeout(timer);
      cycleRemaining.current = Math.max(
        0,
        remaining - (Date.now() - startedAt),
      );
    };
  }, [shouldCycle, paused, loop, count, index, cycleDuration, goTo]);

  // Handle dragging. Touch and trackpad scrolling is left to the browser.
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startScroll: number;
    startIndex: number;
    lastX: number;
    lastTime: number;
    velocity: number;
    active: boolean;
  } | null>(null);

  const suppressNextClick = useCallback(() => {
    const list = listRef.current;
    if (list === null) {
      return;
    }
    const swallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    list.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => list.removeEventListener('click', swallow, true), 0);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const list = listRef.current;
    if (e.pointerType !== 'mouse' || e.button !== 0 || list === null) {
      return;
    }
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startScroll: list.scrollLeft,
      startIndex: indexRef.current,
      lastX: e.clientX,
      lastTime: e.timeStamp,
      velocity: 0,
      active: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const list = listRef.current;
    if (state === null || list === null || e.pointerId !== state.pointerId) {
      return;
    }

    // Check for release outside the container.
    if (e.buttons === 0) {
      drag.current = null;
      return;
    }

    const movedX = e.clientX - state.startX;

    if (!state.active) {
      const movedY = e.clientY - state.startY;
      if (
        Math.abs(movedX) < DRAG_THRESHOLD ||
        Math.abs(movedX) <= Math.abs(movedY)
      ) {
        return;
      }
      state.active = true;
      list.setPointerCapture(e.pointerId);
      setPhase('dragging');
    }

    const elapsed = e.timeStamp - state.lastTime;
    if (elapsed > 0) {
      state.velocity = (e.clientX - state.lastX) / elapsed;
    }
    state.lastX = e.clientX;
    state.lastTime = e.timeStamp;
    list.scrollLeft = state.startScroll - movedX;
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const list = listRef.current;
    if (state === null || list === null || e.pointerId !== state.pointerId) {
      return;
    }

    drag.current = null;
    if (!state.active) {
      return;
    }

    if (list.hasPointerCapture(state.pointerId)) {
      list.releasePointerCapture(state.pointerId);
    }
    suppressNextClick();

    setPhase('settling');

    // Advance to the next slide if the user has flicked.
    const nearest = nearestIndex();
    const flicked =
      e.timeStamp - state.lastTime < FLICK_TIMEOUT &&
      Math.abs(state.velocity) > FLICK_VELOCITY;
    goTo(
      flicked && nearest === state.startIndex
        ? nearest + (state.velocity < 0 ? 1 : -1)
        : nearest,
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Ignore inputs in slides.
    if (e.target !== e.currentTarget) {
      return;
    }

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        goTo(index - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        goTo(index + 1);
        break;
      case 'Home':
        e.preventDefault();
        goTo(0);
        break;
      case 'End':
        e.preventDefault();
        goTo(count - 1);
        break;
    }
  };

  // Only consider keyboard focus, which :focus-visible represents, as the user
  // clicking a dote or pause button would otherwise stop the carousel.
  const handleFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const target = e.target;
    setFocused(target instanceof Element && target.matches(':focus-visible'));
  };

  const classes = [styles.carousel];
  if (className) {
    classes.push(className);
  }

  const viewportStyle = {
    maxWidth: maxItemWidth !== undefined ? maxItemWidth + 2 * peek : undefined,
    '--carousel-peek': `${peek}px`,
  } as React.CSSProperties;

  const hasControls = count > 1;

  // The animation stays attached while paused so that it freezes in place.
  const isRunning = shouldCycle && hasControls;
  const progress = (
    <div
      key={`${slidesId} ${index}`}
      className={styles.progress}
      style={
        isRunning ? { animationDuration: `${cycleDuration}ms` } : undefined
      }
      data-running={isRunning}
      data-paused={paused}
    />
  );

  const arrow = (direction: -1 | 1) => (
    <button
      className={styles.arrow}
      aria-label={direction < 0 ? 'Previous slide' : 'Next slide'}
      disabled={!loop && index === (direction < 0 ? 0 : count - 1)}
      onClick={() => goTo(index + direction)}
    >
      <i className={`fas fa-chevron-${direction < 0 ? 'left' : 'right'}`} />
    </button>
  );

  return (
    <div
      ref={rootRef}
      className={classes.join(' ')}
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
      onMouseEnter={shouldCycle ? () => setHovered(true) : undefined}
      onMouseLeave={shouldCycle ? () => setHovered(false) : undefined}
      onFocus={shouldCycle ? handleFocus : undefined}
      onBlur={shouldCycle ? () => setFocused(false) : undefined}
    >
      <div className={styles.stage}>
        {showArrows && hasControls && arrow(-1)}
        <div
          className={styles.viewport}
          style={viewportStyle}
          data-peek={peek > 0}
        >
          <div
            ref={listRef}
            className={styles.list}
            data-phase={phase}
            tabIndex={0}
            onScroll={armSettle}
            onKeyDown={handleKeyDown}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onDragStart={(e) => e.preventDefault()}
          >
            {slides.map((slide, i) => (
              <div
                key={slideKeys[i]}
                className={styles.item}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${count}`}
              >
                {slide}
              </div>
            ))}
          </div>
        </div>
        {showArrows && hasControls && arrow(1)}
      </div>
      {(hasControls || footer) && (
        <div className={styles.footer}>
          {hasControls && (showDots || shouldCycle) && (
            <div className={styles.indicator}>
              {showDots &&
                (count > MAX_DOTS ? (
                  <div className={styles.counter}>
                    <span>
                      {index + 1} / {count}
                    </span>
                    <div className={styles.track}>{progress}</div>
                  </div>
                ) : (
                  <div className={styles.dots}>
                    {slides.map((_, i) => (
                      <button
                        key={i}
                        className={`${styles.dot} ${i === index ? styles.active : ''}`}
                        aria-label={`Go to slide ${i + 1}`}
                        aria-current={i === index}
                        onClick={() => goTo(i)}
                      >
                        <span className={styles.pill}>
                          {i === index && progress}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              {shouldCycle && (
                <button
                  className={styles.pause}
                  aria-label={
                    stopped ? 'Resume auto-cycling' : 'Pause auto-cycling'
                  }
                  onClick={() => setStopped(!stopped)}
                >
                  <i className={stopped ? 'fas fa-play' : 'fas fa-pause'} />
                </button>
              )}
            </div>
          )}
          {footer}
        </div>
      )}
    </div>
  );
}
