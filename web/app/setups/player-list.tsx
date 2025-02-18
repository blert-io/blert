'use client';

import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { DisplayContext } from '@/display';

import { Player } from './player';
import { GearSetupPlayer } from './setup';
import { SetupViewingContext } from './viewing-context';

import styles from './style.module.scss';

const PLAYER_WIDTH = 200;
const PLAYER_GAP = 10;

/**
 * The minimum drag distance to trigger a slide.
 */
const DRAG_THRESHOLD = 50;

/**
 * The maximum pixels to allow dragging beyond bounds.
 */
const MAX_OVERSCROLL = 30;

type PlayerListProps = {
  className?: string;
  players: GearSetupPlayer[];
  onAddPlayer?: () => void;
  showAddButton?: boolean;
};

export default function PlayerList({
  className,
  players,
  onAddPlayer,
  showAddButton = false,
}: PlayerListProps) {
  const display = useContext(DisplayContext);
  const { highlightedPlayerIndex } = useContext(SetupViewingContext);

  const [currentIndex, setCurrentIndex] = useState(highlightedPlayerIndex ?? 0);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragOffset, setDragOffset] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef(0);
  const hasStartedDragging = useRef(false);

  const isDragging = dragStart !== null;

  const renderCarousel = display.isCompact();

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setDragStart({ x: clientX, y: clientY });
    hasStartedDragging.current = false;
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
        currentIndex === players.length - 1 ? -MAX_OVERSCROLL : -PLAYER_WIDTH;
      const maxBound = currentIndex === 0 ? MAX_OVERSCROLL : PLAYER_WIDTH;
      const boundedOffset = Math.max(minBound, Math.min(maxBound, deltaX));

      dragOffsetRef.current = boundedOffset;
      setDragOffset(boundedOffset);
    },
    [currentIndex, players.length, isDragging, dragStart],
  );

  const handleDragEnd = useCallback(() => {
    if (!isDragging) {
      return;
    }

    const finalOffset = dragOffsetRef.current;

    if (Math.abs(finalOffset) > DRAG_THRESHOLD) {
      // When dragging right (positive offset), go to the previous player.
      // When dragging left (negative offset), go to the next player.
      const direction = finalOffset > 0 ? 1 : -1;
      const newIndex = Math.max(
        0,
        Math.min(players.length - 1, currentIndex - direction),
      );
      setCurrentIndex(newIndex);
    }

    setDragStart(null);
    setDragOffset(0);
    dragOffsetRef.current = 0;
  }, [currentIndex, players.length, isDragging]);

  useEffect(() => {
    if (!renderCarousel) {
      return;
    }

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
  }, [
    isDragging,
    renderCarousel,
    currentIndex,
    players.length,
    handleDragMove,
    handleDragEnd,
  ]);

  useEffect(() => {
    if (!renderCarousel) {
      return;
    }

    if (currentIndex >= players.length) {
      setCurrentIndex(players.length - 1);
    }
  }, [players.length, currentIndex, renderCarousel]);

  const wrapperStyles: React.CSSProperties = {};
  const listStyles: React.CSSProperties = {};

  if (renderCarousel) {
    wrapperStyles.width = PLAYER_WIDTH;

    const translateX = -(currentIndex * PLAYER_WIDTH) + dragOffset;
    listStyles.transform = `translateX(${translateX}px)`;
    listStyles.width = PLAYER_WIDTH * players.length;
  } else {
    wrapperStyles.width = '100%';

    listStyles.width = '100%';
    listStyles.flexWrap = 'wrap';
    listStyles.gap = PLAYER_GAP;
  }

  const classes = [styles.panel, styles.players];
  if (isDragging) {
    classes.push(styles.dragging);
  }
  if (className) {
    classes.push(className);
  }

  const addPlayerButton = (
    <div className={styles.addPlayer}>
      <button onClick={onAddPlayer}>
        <i className="fas fa-plus" />
        <span>{renderCarousel ? 'Add player' : 'Add'}</span>
      </button>
    </div>
  );

  return (
    <div className={classes.join(' ')}>
      {renderCarousel && (
        <button
          className={styles.arrow}
          disabled={currentIndex === 0}
          onClick={() => setCurrentIndex(currentIndex - 1)}
        >
          <i className="fas fa-chevron-left" />
        </button>
      )}
      <div className={styles.wrapper} style={wrapperStyles}>
        <div
          ref={listRef}
          className={`${styles.list} ${isDragging ? styles.dragging : ''}`}
          style={listStyles}
          onMouseDown={renderCarousel ? handleDragStart : undefined}
          onTouchStart={renderCarousel ? handleDragStart : undefined}
        >
          {players.map((player, index) => (
            <Player key={index} index={index} player={player} />
          ))}
          {!renderCarousel && showAddButton && addPlayerButton}
        </div>
        {renderCarousel && (
          <div className={styles.footer}>
            <div className={styles.dots}>
              {players.map((_, index) => (
                <button
                  key={index}
                  className={`${styles.dot} ${index === currentIndex ? styles.active : ''}`}
                  onClick={() => setCurrentIndex(index)}
                />
              ))}
            </div>
            {showAddButton && addPlayerButton}
          </div>
        )}
      </div>
      {renderCarousel && (
        <button
          className={styles.arrow}
          disabled={currentIndex === players.length - 1}
          onClick={() => setCurrentIndex(currentIndex + 1)}
        >
          <i className="fas fa-chevron-right" />
        </button>
      )}
    </div>
  );
}
