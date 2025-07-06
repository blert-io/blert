'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import Checkbox from '@/components/checkbox';
import RadioInput from '@/components/radio-input';
import { TICK_MS } from '@/utils/tick';

import { useReplayContext } from './replay-context';

import mapStyles from './style.module.scss';
import styles from './map-settings.module.scss';

type PlaybackSpeed = {
  label: string;
  value: number;
  multiplier: number;
};

const PLAYBACK_SPEEDS: PlaybackSpeed[] = [
  { label: '0.25x', value: TICK_MS * 4, multiplier: 0.25 },
  { label: '0.5x', value: TICK_MS * 2, multiplier: 0.5 },
  { label: '1x', value: TICK_MS, multiplier: 1 },
  { label: '1.5x', value: Math.round(TICK_MS / 1.5), multiplier: 1.5 },
  { label: '2x', value: TICK_MS / 2, multiplier: 2 },
  { label: '4x', value: TICK_MS / 4, multiplier: 4 },
];

type MapSettingsProps = {
  className?: string;
};

export default function MapSettings({ className }: MapSettingsProps) {
  const { config, updateConfig, playing } = useReplayContext();
  const [isExpanded, setIsExpanded] = useState(false);
  const uniqueId = useId();
  const ref = useRef<HTMLDivElement>(null);

  const handleInterpolationChange = useCallback(
    (enabled: boolean) => {
      updateConfig((prev) => ({
        ...prev,
        interpolationEnabled: enabled,
      }));
    },
    [updateConfig],
  );

  const handlePlaybackSpeedChange = useCallback(
    (value: number | string) => {
      const tickDuration = Number(value);
      updateConfig((prev) => ({
        ...prev,
        tickDuration,
      }));
    },
    [updateConfig],
  );

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  return (
    <div className={className} ref={ref}>
      <button
        className={`${mapStyles.mapButton} ${styles.settingsToggle} ${playing ? styles.playing : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <i className={`fas fa-cog ${styles.settingsIcon}`} />
        <span className="sr-only">Settings</span>
        <i
          className={`fas fa-chevron-down ${styles.chevronIcon} ${isExpanded ? styles.expanded : ''}`}
        />
      </button>

      <div
        className={`${styles.settingsPanel} ${isExpanded ? styles.expanded : ''}`}
      >
        <div
          className={`${styles.settingsContent} ${playing ? styles.disabled : ''}`}
        >
          {playing && (
            <div className={styles.playingNotice}>
              <i className="fas fa-play" />
              <span>Settings disabled during playback</span>
            </div>
          )}
          <div className={styles.settingGroup}>
            <h4 className={styles.settingLabel}>Animation</h4>
            <Checkbox
              label="Smooth movement"
              checked={config.interpolationEnabled}
              onChange={handleInterpolationChange}
              disabled={playing}
              simple
            />
          </div>

          <div className={styles.settingGroup}>
            <h4 className={styles.settingLabel}>Playback Speed</h4>
            <RadioInput.Group
              name={`playback-speed-${uniqueId}`}
              onChange={handlePlaybackSpeedChange}
              compact
              joined
              readOnly={playing}
            >
              {PLAYBACK_SPEEDS.map((speed) => (
                <RadioInput.Option
                  key={speed.value}
                  value={speed.value}
                  id={`speed-${speed.value}-${uniqueId}`}
                  label={speed.label}
                  checked={config.tickDuration === speed.value}
                />
              ))}
            </RadioInput.Group>
          </div>
        </div>
      </div>
    </div>
  );
}
