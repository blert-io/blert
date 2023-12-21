import { MouseEventHandler, useRef, useState } from 'react';

import styles from './style.module.css';

type Milestone = {
  tick: number;
  label: string;
};

type ProgressBarProps = {
  milestones?: Milestone[];
  onTickSelected?: (tick: number) => void;
  tick: number;
  totalTicks: number;
  height: number;
  width: number;
};

const HOVER_TICK_INDICATOR_WIDTH = 80;
const HOVER_TICK_POINTER_WIDTH = 10;

export default function ProgressBar(props: ProgressBarProps) {
  const barRef = useRef(null);
  const [hovering, setHovering] = useState(false);
  const [cursorX, setCursorX] = useState(0);

  // Account for the size of the border (we don't use `border-box` as the
  // overlays are manually sized).
  const adjustedWidth = props.width - 2;
  const adjustedHeight = props.height - 2;

  const onMouseMove: MouseEventHandler = (e) => {
    const x = e.nativeEvent.offsetX;
    if (x > 0 && x < props.width + 1) {
      setCursorX(x);
    }
  };

  const pxPerTick = adjustedWidth / props.totalTicks;
  const hoveredTick = Math.min(
    Math.floor(cursorX / pxPerTick) + 1,
    props.totalTicks,
  );

  const milestones = props.milestones ?? [];

  return (
    <div
      className={styles.bar}
      onClick={() => props.onTickSelected?.(hoveredTick)}
      onMouseEnter={() => setHovering(true)}
      onMouseMove={onMouseMove}
      onMouseLeave={() => {
        setHovering(false);
        setCursorX(0);
      }}
      ref={barRef}
      style={{
        height: adjustedHeight,
        width: adjustedWidth,
        marginBottom: milestones.length > 0 ? 30 : 0,
      }}
    >
      <div
        className={styles.progress}
        style={{ width: props.tick * pxPerTick }}
      />
      <div className={styles.hover} style={{ width: cursorX }} />
      {hovering && (
        <div
          className={styles.tick}
          style={{
            width: HOVER_TICK_INDICATOR_WIDTH,
            left: cursorX - HOVER_TICK_INDICATOR_WIDTH / 2,
            top: -40,
          }}
        >
          <div
            className={styles.pointer}
            style={{
              left:
                HOVER_TICK_INDICATOR_WIDTH / 2 - HOVER_TICK_POINTER_WIDTH / 2,
              bottom: -(HOVER_TICK_POINTER_WIDTH / 2),
            }}
          />
          tick {hoveredTick}
        </div>
      )}
      {milestones.map((m) => (
        <div
          className={styles.milestone}
          key={m.tick}
          style={{ left: (m.tick - 1) * pxPerTick }}
        >
          <div className={styles.label}>{m.label}</div>
        </div>
      ))}
    </div>
  );
}
