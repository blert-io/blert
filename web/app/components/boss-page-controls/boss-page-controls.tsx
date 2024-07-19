'use client';

import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';

import { TimelineSplit } from '@/components/attack-timeline';
import { clamp } from '@/utils/math';
import { ticksToFormattedSeconds } from '@/utils/tick';

import styles from './styles.module.scss';

interface BossControlsProps {
  currentlyPlaying: boolean;
  totalTicks: number;
  currentTick: number;
  updateTick: Dispatch<SetStateAction<number>>;
  updatePlayingState: (isPlaying: boolean) => void;
  splits: TimelineSplit[];
}

export function BossPageControls(props: BossControlsProps) {
  const {
    currentlyPlaying,
    totalTicks,
    currentTick,
    updateTick,
    updatePlayingState,
    splits,
  } = props;

  // The value of the tick input field. Tracked separately to `currentTick` to
  // allow users to clear the input.
  const [value, setValue] = useState(currentTick.toString());
  const [inputFocused, setInputFocused] = useState(false);
  const scrubber = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (scrubber.current) {
        event.preventDefault();
        if (event.deltaY > 0) {
          updateTick((tick) => clamp(tick + 1, 1, totalTicks));
        } else {
          updateTick((tick) => clamp(tick - 1, 1, totalTicks));
        }
      }
    };

    const current = scrubber.current;
    current?.addEventListener('wheel', onWheel);
    return () => {
      current?.removeEventListener('wheel', onWheel);
    };
  }, [totalTicks, updateTick]);

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

  const scrubberSplits = splits
    .filter((split) => !split.unimportant)
    .map((split) => {
      const splitPosition = (split.tick / totalTicks) * 100;
      return (
        <div
          key={split.splitName}
          className={styles.controls__scrubber__split}
          style={{ left: `calc(${splitPosition}% - 3px)` }}
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
    });

  return (
    <>
      <div className={styles.controls}>
        <div className={styles.controls__main}>
          <button
            className={styles.controls__playButton}
            disabled={currentlyPlaying}
            onClick={() => {
              if (currentlyPlaying) return;
              updatePlayingState(true);
            }}
          >
            <i
              className={`${styles.controls_BtnIcon} fa-regular fa-circle-play`}
            ></i>
          </button>
          <button
            className={styles.controls__pauseButton}
            disabled={!currentlyPlaying}
            onClick={() => {
              if (!currentlyPlaying) return;
              updatePlayingState(false);
            }}
          >
            <i
              className={`${styles.controls_BtnIcon} fa-regular fa-circle-pause`}
            ></i>
          </button>
          <button
            className={styles.controls__restartButton}
            disabled={currentTick === 1}
            onClick={() => {
              if (currentTick === 1) return;
              updateTick(1);
              updatePlayingState(false);
            }}
          >
            <i
              className={`${styles.controls_BtnIcon} fa-solid fa-rotate-left`}
            ></i>
          </button>
          <div className={styles.controls__tickInputLabel}>Current Tick:</div>
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
                const clampedValue = clamp(newValue, 1, totalTicks);
                updateTick(clampedValue);
                setValue(event.target.value);
              } catch (e) {
                updateTick(1);
              }
            }}
            onFocus={() => setInputFocused(true)}
            max={totalTicks}
            value={value}
          />
          <div className={styles.roomTime}>
            <div className={styles.time}>
              {ticksToFormattedSeconds(currentTick)}
            </div>
            <span>/</span>
            <div className={styles.time}>
              {ticksToFormattedSeconds(totalTicks)}
            </div>
          </div>
        </div>
        <div className={styles.controls__scrubber} ref={scrubber}>
          <div className={styles.controls__scrubber__splits}>
            {scrubberSplits}
          </div>
          <input
            type="range"
            id="timeline-scrubber"
            name="timeline-scrubber"
            min={1}
            value={currentTick}
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
                const clampedValue = clamp(newValue, 1, totalTicks);
                updateTick(clampedValue);
                setValue(event.target.value);
              } catch (e) {
                updateTick(1);
              }
            }}
            max={totalTicks}
          />
        </div>
      </div>
      <div className={styles.controlsPadding} />
    </>
  );
}
