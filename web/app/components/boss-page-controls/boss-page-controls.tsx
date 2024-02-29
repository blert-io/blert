'use client';

import { useEffect, useState } from 'react';
import { clamp } from '../../utils/math';
import styles from './styles.module.scss';
import Image from 'next/image';

interface BossControlsProps {
  currentlyPlaying: boolean;
  totalTicks: number;
  currentTick: number;
  updateTick: (tick: number) => void;
  updatePlayingState: (isPlaying: boolean) => void;
}

export function BossPageControls(props: BossControlsProps) {
  const {
    currentlyPlaying,
    totalTicks,
    currentTick,
    updateTick,
    updatePlayingState,
  } = props;

  // The value of the tick input field. Tracked separately to `currentTick` to
  // allow users to clear the input.
  const [value, setValue] = useState(currentTick.toString());

  useEffect(() => {
    if (currentlyPlaying) {
      setValue(currentTick.toString());
    }
  }, [currentlyPlaying, currentTick]);

  // get how far down the window this element is
  const [position, setPosition] = useState(0);
  useEffect(() => {
    const handleScroll = () => {
      setPosition(window.scrollY);
    };

    window.addEventListener('scroll', handleScroll);

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  if (
    totalTicks === undefined ||
    currentTick === undefined ||
    Number.isNaN(currentTick)
  ) {
    return <div className={styles.contrls}>Loading...</div>;
  }

  return (
    <div className={styles.controls}>
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
        <i className={`${styles.controls_BtnIcon} fa-solid fa-rotate-left`}></i>
      </button>
      <div className={styles.controls__tickInputLabel}>Current Tick:</div>
      <input
        className={styles.controls__tickInput}
        type="number"
        name="tick"
        disabled={currentlyPlaying}
        min={1}
        onBlur={(e) => {
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
        value={value}
      />

      <div className={styles.controls__roomActor}>
        <Image
          src="/maiden.webp"
          alt="Maiden of Sugadinti"
          width={35}
          height={35}
        />
      </div>
    </div>
  );
}
