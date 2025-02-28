import { useCallback, useEffect, useRef, useState } from 'react';

import styles from './style.module.scss';

/**
 * The minimum drag distance to trigger a slide.
 */
const DRAG_THRESHOLD = 50;

/**
 * The maximum pixels to allow dragging beyond bounds.
 */
const MAX_OVERSCROLL = 30;

export type CarouselProps = {
  children: React.ReactNode[];
  itemWidth: number;
  currentIndex?: number;
  onIndexChange?: (index: number) => void;
  showDots?: boolean;
  showArrows?: boolean;
  className?: string;
  footer?: React.ReactNode;
  autoCycle?: boolean;
  cycleDuration?: number;
};

export default function Carousel({
  children,
  itemWidth,
  currentIndex: controlledIndex,
  onIndexChange,
  showDots = true,
  showArrows = true,
  className,
  footer,
  autoCycle = false,
  cycleDuration = 5000,
}: CarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(controlledIndex ?? 0);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragOffset, setDragOffset] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef(0);
  const hasStartedDragging = useRef(false);
  const cycleTimeoutRef = useRef<NodeJS.Timeout>();

  const isDragging = dragStart !== null;

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setDragStart({ x: clientX, y: clientY });
    hasStartedDragging.current = false;
    setIsPaused(true);
  };

  const handleDragMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDragging) {
        return;
      }

      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const deltaX = clientX - dragStart.x;
      const deltaY = clientY - dragStart.y;

      // If we haven't started dragging yet, check if this is a primarily
      // vertical movement.
      if (!hasStartedDragging.current) {
        if (Math.abs(deltaX) < 5 && Math.abs(deltaY) < 5) {
          // Too small to determine direction.
          return;
        }
        if (Math.abs(deltaY) > Math.abs(deltaX)) {
          setDragStart(null);
          return;
        }
        hasStartedDragging.current = true;
      }

      // Limit dragging beyond bounds.
      const minBound =
        currentIndex === children.length - 1 ? -MAX_OVERSCROLL : -itemWidth;
      const maxBound = currentIndex === 0 ? MAX_OVERSCROLL : itemWidth;
      const boundedOffset = Math.max(minBound, Math.min(maxBound, deltaX));

      dragOffsetRef.current = boundedOffset;
      setDragOffset(boundedOffset);
    },
    [currentIndex, children.length, isDragging, dragStart, itemWidth],
  );

  const handleDragEnd = useCallback(() => {
    if (!isDragging) {
      return;
    }

    const finalOffset = dragOffsetRef.current;

    if (Math.abs(finalOffset) > DRAG_THRESHOLD) {
      // When dragging right (positive offset), go to the previous item.
      // When dragging left (negative offset), go to the next item.
      const direction = finalOffset > 0 ? 1 : -1;
      const newIndex = Math.max(
        0,
        Math.min(children.length - 1, currentIndex - direction),
      );
      setCurrentIndex(newIndex);
      onIndexChange?.(newIndex);
    }

    setDragStart(null);
    setDragOffset(0);
    dragOffsetRef.current = 0;
  }, [currentIndex, children.length, isDragging, onIndexChange]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => handleDragMove(e as any);
    const handleTouchMove = (e: TouchEvent) => handleDragMove(e as any);
    const handleEnd = () => handleDragEnd();

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('mouseup', handleEnd);
      window.addEventListener('touchend', handleEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  useEffect(() => {
    if (controlledIndex !== undefined && controlledIndex !== currentIndex) {
      setCurrentIndex(controlledIndex);
    }
  }, [controlledIndex]);

  useEffect(() => {
    if (currentIndex >= children.length) {
      setCurrentIndex(children.length - 1);
      onIndexChange?.(children.length - 1);
    }
  }, [children.length, currentIndex, onIndexChange]);

  const cycleToNextItem = useCallback(() => {
    if (isPaused) {
      return;
    }

    const nextIndex = (currentIndex + 1) % children.length;
    setCurrentIndex(nextIndex);
    onIndexChange?.(nextIndex);
  }, [currentIndex, children.length, onIndexChange, isPaused]);

  useEffect(() => {
    if (!autoCycle || isPaused) {
      if (cycleTimeoutRef.current) {
        clearTimeout(cycleTimeoutRef.current);
      }
      return;
    }

    cycleTimeoutRef.current = setTimeout(cycleToNextItem, cycleDuration);

    return () => {
      if (cycleTimeoutRef.current) {
        clearTimeout(cycleTimeoutRef.current);
      }
    };
  }, [autoCycle, cycleDuration, cycleToNextItem, isPaused]);

  const handleMouseEnter = () => {
    setIsPaused(true);
  };

  const handleMouseLeave = () => {
    setIsPaused(false);
  };

  const wrapperStyles: React.CSSProperties = {
    width: itemWidth,
  };

  const listStyles: React.CSSProperties = {
    transform: `translateX(${-(currentIndex * itemWidth) + dragOffset}px)`,
    width: itemWidth * children.length,
  };

  const classes = [styles.carousel];
  if (isDragging) {
    classes.push(styles.dragging);
  }
  if (className) {
    classes.push(className);
  }

  return (
    <div
      className={classes.join(' ')}
      onMouseEnter={autoCycle ? handleMouseEnter : undefined}
      onMouseLeave={autoCycle ? handleMouseLeave : undefined}
    >
      {showArrows && (
        <button
          className={styles.arrow}
          disabled={currentIndex === 0}
          onClick={() => {
            setCurrentIndex(currentIndex - 1);
            onIndexChange?.(currentIndex - 1);
            setIsPaused(true);
          }}
        >
          <i className="fas fa-chevron-left" />
        </button>
      )}
      <div className={styles.wrapper} style={wrapperStyles}>
        <div
          ref={listRef}
          className={`${styles.list} ${isDragging ? styles.dragging : ''}`}
          style={listStyles}
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
        >
          {children}
        </div>
        {(showDots || footer) && (
          <div className={styles.footer}>
            {showDots && (
              <div className={styles.dots}>
                {children.map((_, index) => (
                  <button
                    key={index}
                    className={`${styles.dot} ${
                      index === currentIndex ? styles.active : ''
                    }`}
                    onClick={() => {
                      setCurrentIndex(index);
                      onIndexChange?.(index);
                      setIsPaused(true);
                    }}
                  />
                ))}
              </div>
            )}
            {footer}
          </div>
        )}
      </div>
      {showArrows && (
        <button
          className={styles.arrow}
          disabled={currentIndex === children.length - 1}
          onClick={() => {
            setCurrentIndex(currentIndex + 1);
            onIndexChange?.(currentIndex + 1);
            setIsPaused(true);
          }}
        >
          <i className="fas fa-chevron-right" />
        </button>
      )}
    </div>
  );
}
