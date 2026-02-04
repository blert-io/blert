'use client';

import {
  Dispatch,
  SetStateAction,
  useContext,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
} from 'react';

import { TimelineSplit } from '@/components/attack-timeline';
import { DisplayContext } from '@/display';
import { clamp } from '@/utils/math';
import { ticksToFormattedSeconds } from '@/utils/tick';

import styles from './styles.module.scss';

interface BossControlsProps {
  currentlyPlaying: boolean;
  totalTicks: number;
  currentTick: number;
  updateTick: Dispatch<SetStateAction<number>>;
  updatePlayingState: (isPlaying: boolean) => void;
  splits?: TimelineSplit[];
}

export function BossPageControls(props: BossControlsProps) {
  const {
    currentlyPlaying,
    totalTicks,
    currentTick,
    updateTick,
    updatePlayingState,
    splits = [],
  } = props;
  const maxTick = Math.max(1, totalTicks - 1);

  const display = useContext(DisplayContext);

  // The value of the tick input field. Tracked separately to `currentTick` to
  // allow users to clear the input.
  const [value, setValue] = useState(currentTick.toString());
  const [inputFocused, setInputFocused] = useState(false);
  const scrubber = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const [trackWidth, setTrackWidth] = useState<number>(0);
  // Update trackWidth on mount and when window resizes
  useLayoutEffect(() => {
    function updateWidth() {
      if (rangeRef.current) {
        setTrackWidth(rangeRef.current.getBoundingClientRect().width);
      }
    }
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (scrubber.current) {
        event.preventDefault();
        if (event.deltaY > 0) {
          updateTick((tick) => clamp(tick + 1, 1, maxTick));
        } else {
          updateTick((tick) => clamp(tick - 1, 1, maxTick));
        }
      }
    };

    const current = scrubber.current;
    current?.addEventListener('wheel', onWheel);
    return () => {
      current?.removeEventListener('wheel', onWheel);
    };
  }, [maxTick, updateTick]);

  useEffect(() => {
    if (!inputFocused) {
      setValue(currentTick.toString());
    }
  }, [currentTick, inputFocused]);

  if (
    totalTicks === undefined ||
    currentTick === undefined ||
    Number.isNaN(currentTick)
  ) {
    return <div className={styles.contrls}>Loading...</div>;
  }

  const thumbWidth = 16;
  const scrubberSplits =
    display.isFull() && trackWidth > 0
      ? splits
          .filter((split) => !split.unimportant)
          .map((split) => {
            const boundedTick = clamp(split.tick, 1, maxTick);
            const percent =
              maxTick === 1 ? 0 : (boundedTick - 1) / (maxTick - 1);
            const left = percent * (trackWidth - thumbWidth) + thumbWidth / 2;
            return (
              <div
                key={split.tick}
                className={styles.controls__scrubber__split}
                style={{ left: `${left + 1}px` }}
              >
                <div
                  className={styles.controls__splitTextWrapper}
                  onClick={() => {
                    updateTick(split.tick);
                  }}
                >
                  <span>{split.splitName}</span>
                </div>
              </div>
            );
          })
      : [];

  const scrubberElement = (
    <div className={styles.controls__scrubber} ref={scrubber}>
      <div className={styles.controls__scrubber__splits}>{scrubberSplits}</div>
      <input
        type="range"
        id="timeline-scrubber"
        name="timeline-scrubber"
        min={1}
        value={currentTick}
        ref={rangeRef}
        onBlur={() => {
          setInputFocused(false);
          updatePlayingState(false);
        }}
        onChange={(event) => {
          try {
            let newValue = parseInt(event.target.value);
            if (Number.isNaN(newValue)) {
              newValue = 1;
            }
            const clampedValue = clamp(newValue, 1, maxTick);
            updateTick(clampedValue);
            setValue(event.target.value);
          } catch {
            updateTick(1);
          }
        }}
        max={maxTick}
      />
    </div>
  );

  const roomTime = (
    <div className={styles.roomTime}>
      <div className={styles.time}>{ticksToFormattedSeconds(currentTick)}</div>
      <span>/</span>
      <div className={styles.time}>{ticksToFormattedSeconds(totalTicks)}</div>
    </div>
  );

  return (
    <>
      <div className={styles.controls}>
        <div className={styles.wrapper}>
          {display.isCompact() && scrubberElement}
          {display.isCompact() && roomTime}
          <div className={styles.controls__main}>
            <button
              className={styles.playbackButton}
              onClick={() => updatePlayingState(!currentlyPlaying)}
            >
              <i
                className={`${styles.icon} far fa-circle-${currentlyPlaying ? 'pause' : 'play'}`}
              />
            </button>
            <button
              className={styles.playbackButton}
              disabled={currentTick === 1}
              onClick={() => {
                if (currentTick === 1) {
                  return;
                }
                updateTick(1);
                updatePlayingState(false);
              }}
            >
              <i className={`${styles.icon} fa-solid fa-rotate-left`} />
            </button>
            <div className={styles.tickInput}>
              <div className={styles.controls__tickInputLabel}>Tick:</div>
              <input
                className={styles.controls__tickInput}
                type="number"
                name="tick"
                disabled={currentlyPlaying}
                min={1}
                onBlur={() => {
                  setInputFocused(false);
                  updatePlayingState(false);
                }}
                onChange={(event) => {
                  try {
                    let newValue = parseInt(event.target.value);
                    if (Number.isNaN(newValue)) {
                      newValue = 1;
                    }
                    const clampedValue = clamp(newValue, 1, maxTick);
                    updateTick(clampedValue);
                    setValue(event.target.value);
                  } catch {
                    updateTick(1);
                  }
                }}
                onFocus={() => setInputFocused(true)}
                max={maxTick}
                value={value}
              />
            </div>
            {display.isFull() && roomTime}
          </div>
          {display.isFull() && scrubberElement}
        </div>
      </div>
      <div className={styles.controlsPadding} />
    </>
  );
}
