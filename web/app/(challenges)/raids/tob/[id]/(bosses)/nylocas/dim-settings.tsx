'use client';

import { useEffect, useRef, useState } from 'react';

import Checkbox from '@/components/checkbox';
import RadioInput from '@/components/radio-input';
import { useSetting } from '@/utils/user-settings';

import styles from './style.module.scss';

export type DimThreshold = {
  wave: number;
  offset: number;
};

export type NyloDimConfig = {
  preset: DimThreshold | null;
  custom: DimThreshold[];
};

const PRESET_DIMS: { label: string; threshold: DimThreshold }[] = [
  { label: 'W26', threshold: { wave: 26, offset: 0 } },
  { label: 'W27', threshold: { wave: 27, offset: 0 } },
  { label: 'W27+4', threshold: { wave: 27, offset: 4 } },
  { label: 'W28', threshold: { wave: 28, offset: 0 } },
  { label: 'W29', threshold: { wave: 29, offset: 0 } },
];

function thresholdEquals(a: DimThreshold, b: DimThreshold): boolean {
  return a.wave === b.wave && a.offset === b.offset;
}

function thresholdKey(t: DimThreshold): string {
  return t.offset === 0 ? `W${t.wave}` : `W${t.wave}+${t.offset}`;
}

type NyloDimSettingsProps = {
  scale: number;
  disabled?: boolean;
  onDimThresholdsChange: (thresholds: DimThreshold[]) => void;
  onShowLabelsChange: (showLabels: boolean) => void;
};

export default function NyloDimSettings({
  scale,
  disabled = false,
  onDimThresholdsChange,
  onShowLabelsChange,
}: NyloDimSettingsProps) {
  const [dimConfig, setDimConfig] = useSetting<NyloDimConfig>({
    key: `nylo-dims-${scale}`,
    defaultValue: { preset: null, custom: [] },
  });

  const [showLabels, setShowLabels] = useSetting<boolean>({
    key: 'nylo-show-labels',
    defaultValue: true,
  });

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [customWave, setCustomWave] = useState(20);
  const [customOffset, setCustomOffset] = useState(0);
  const waveInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const thresholds: DimThreshold[] = [];
    if (dimConfig.preset !== null) {
      thresholds.push(dimConfig.preset);
    }
    thresholds.push(...dimConfig.custom);
    onDimThresholdsChange(thresholds);
  }, [dimConfig, onDimThresholdsChange]);

  useEffect(() => {
    onShowLabelsChange(showLabels);
  }, [showLabels, onShowLabelsChange]);

  useEffect(() => {
    // Focus wave input when dropdown opens.
    if (dropdownOpen && waveInputRef.current) {
      waveInputRef.current.focus();
      waveInputRef.current.select();
    }
  }, [dropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [dropdownOpen]);

  const updateConfig = (newConfig: NyloDimConfig) => {
    setDimConfig(newConfig);
  };

  const selectedPresetIndex = dimConfig.preset
    ? PRESET_DIMS.findIndex((p) =>
        thresholdEquals(p.threshold, dimConfig.preset!),
      )
    : -1;

  const handlePresetChange = (value: number | string) => {
    const index = Number(value);
    if (index === -1) {
      updateConfig({ ...dimConfig, preset: null });
    } else {
      updateConfig({ ...dimConfig, preset: PRESET_DIMS[index].threshold });
    }
  };

  const handleAddCustom = () => {
    const newThreshold = { wave: customWave, offset: customOffset };
    const isDuplicate =
      dimConfig.custom.some((t) => thresholdEquals(t, newThreshold)) ||
      (dimConfig.preset && thresholdEquals(dimConfig.preset, newThreshold));
    if (!isDuplicate) {
      updateConfig({
        ...dimConfig,
        custom: [...dimConfig.custom, newThreshold],
      });
    }
    setDropdownOpen(false);
  };

  const handleRemoveCustom = (threshold: DimThreshold) => {
    updateConfig({
      ...dimConfig,
      custom: dimConfig.custom.filter((t) => !thresholdEquals(t, threshold)),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddCustom();
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
    }
  };

  return (
    <div className={styles.dimSettings}>
      <div className={styles.dimSection}>
        <span className={styles.dimSettingsLabel}>Dim:</span>

        <div className={styles.dimControls}>
          <div className={styles.dimPresetRow}>
            <RadioInput.Group
              name="nylo-dim-preset"
              joined
              compact
              onChange={handlePresetChange}
              readOnly={disabled}
            >
              <RadioInput.Option
                id="nylo-dim-none"
                value={-1}
                label="None"
                checked={selectedPresetIndex === -1}
                disabled={disabled}
              />
              {PRESET_DIMS.map((preset, index) => (
                <RadioInput.Option
                  key={preset.label}
                  id={`nylo-dim-${preset.label}`}
                  value={index}
                  label={preset.label}
                  checked={selectedPresetIndex === index}
                  disabled={disabled}
                />
              ))}
            </RadioInput.Group>
          </div>

          <div className={styles.dimCustomRow}>
            {dimConfig.custom
              .toSorted((a, b) => a.wave - b.wave || a.offset - b.offset)
              .map((threshold) => (
                <button
                  key={thresholdKey(threshold)}
                  className={styles.customDimChip}
                  onClick={() => handleRemoveCustom(threshold)}
                  disabled={disabled}
                  title="Click to remove"
                >
                  {thresholdKey(threshold)}
                  <span className={styles.removeIcon}>&times;</span>
                </button>
              ))}

            <div className={styles.customDropdownContainer} ref={dropdownRef}>
              <button
                className={styles.addCustomButton}
                onClick={() => setDropdownOpen(!dropdownOpen)}
                disabled={disabled}
              >
                <i className="fas fa-plus" />
                Custom
              </button>

              {dropdownOpen && (
                <div className={styles.customDropdown}>
                  <div className={styles.dropdownContent}>
                    <label className={styles.dropdownInput}>
                      <span>Wave</span>
                      <input
                        ref={waveInputRef}
                        type="number"
                        min={1}
                        max={31}
                        value={customWave}
                        onChange={(e) => setCustomWave(Number(e.target.value))}
                        onKeyDown={handleKeyDown}
                        disabled={disabled}
                      />
                    </label>
                    <label className={styles.dropdownInput}>
                      <span>Offset</span>
                      <input
                        type="number"
                        min={0}
                        max={96}
                        value={customOffset}
                        onChange={(e) =>
                          setCustomOffset(Number(e.target.value))
                        }
                        onKeyDown={handleKeyDown}
                        disabled={disabled}
                      />
                    </label>
                  </div>
                  <div className={styles.dropdownActions}>
                    <button
                      className={styles.dropdownCancel}
                      onClick={() => setDropdownOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className={styles.dropdownAdd}
                      onClick={handleAddCustom}
                      disabled={disabled}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.dimSeparator} />

      <Checkbox
        label="Show wave numbers"
        checked={showLabels}
        onChange={setShowLabels}
        disabled={disabled}
        simple
      />
    </div>
  );
}
