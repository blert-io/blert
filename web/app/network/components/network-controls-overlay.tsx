'use client';

import { useState, useCallback } from 'react';
import { ChallengeMode } from '@blert/common';

import Checkbox from '@/components/checkbox';
import PlayerSearch from '@/components/player-search';
import RadioInput from '@/components/radio-input';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import { scaleNameAndColor } from '@/utils/challenge';

import { NetworkFilters } from '../network-content';

import styles from './network-controls-overlay.module.scss';

type NetworkControlsOverlayProps = {
  filters: NetworkFilters;
  onFiltersChange: (filters: NetworkFilters) => void;
  loading: boolean;
  nodeCount: number;
  edgeCount: number;
  focusedPlayer: string | null;
  onFocusPlayer: (username: string | null) => void;
};

function scaleDisplay(scales?: number[]) {
  if (!scales || scales.length === 0 || scales.length === 5) {
    return 'All scales';
  }
  return scales.map((scale) => scaleNameAndColor(scale)[0]).join(', ');
}

export default function NetworkControlsOverlay({
  filters,
  onFiltersChange,
  loading,
  nodeCount,
  edgeCount,
  focusedPlayer,
  onFocusPlayer,
}: NetworkControlsOverlayProps) {
  const [searchValue, setSearchValue] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const handleModeChange = useCallback(
    (value: string | number) => {
      const mode =
        value === 'all'
          ? undefined
          : (parseInt(value.toString()) as ChallengeMode);
      onFiltersChange({
        ...filters,
        mode,
      });
    },
    [filters, onFiltersChange],
  );

  const handleScaleChange = useCallback(
    (scaleValue: string, checked: boolean) => {
      const scale = parseInt(scaleValue);
      const currentScales = filters.scale || [];

      let newScales: number[];
      if (checked) {
        newScales = [...currentScales, scale];
      } else {
        newScales = currentScales.filter((s) => s !== scale);
      }

      onFiltersChange({
        ...filters,
        scale: newScales.length > 0 ? newScales : undefined,
      });
    },
    [filters, onFiltersChange],
  );

  const handleMinConnectionsChange = useCallback(
    (value: string) => {
      const minConnections = parseInt(value) || 5;
      onFiltersChange({
        ...filters,
        minConnections,
      });
    },
    [filters, onFiltersChange],
  );

  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (searchValue.trim()) {
        onFocusPlayer(searchValue.trim());
      } else {
        onFocusPlayer(null);
      }
      setSearchValue('');
    },
    [searchValue, onFocusPlayer],
  );

  const handleClearFocus = useCallback(() => {
    setSearchValue('');
    onFocusPlayer(null);
  }, [onFocusPlayer]);

  const getModeDisplayName = (mode?: ChallengeMode) => {
    if (!mode) {
      return 'All Modes';
    }
    switch (mode) {
      case ChallengeMode.TOB_REGULAR:
        return 'Regular';
      case ChallengeMode.TOB_HARD:
        return 'Hard Mode';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className={styles.controlsOverlay}>
      <div className={styles.collapsedHeader}>
        <div className={styles.headerLeft}>
          <div className={styles.titleSection}>
            <i className="fas fa-sliders-h" />
            <span className={styles.title}>Network Filters</span>
          </div>

          <div className={styles.filterSummary}>
            <span className={styles.filterItem}>
              <i className="fas fa-users" />
              {scaleDisplay(filters.scale)}
            </span>
            {filters.mode && (
              <span className={styles.filterItem}>
                <i className="fas fa-trophy" />
                {getModeDisplayName(filters.mode)}
              </span>
            )}
            {focusedPlayer && (
              <span className={styles.filterItem}>
                <i className="fas fa-crosshairs" />
                {focusedPlayer}
                <button
                  className={styles.clearFocusButton}
                  onClick={handleClearFocus}
                >
                  <i className="fas fa-times" />
                </button>
              </span>
            )}
          </div>
        </div>

        <div className={styles.headerRight}>
          <div className={styles.networkStats}>
            <span
              className={styles.stat}
              data-tooltip-id={GLOBAL_TOOLTIP_ID}
              data-tooltip-content="Number of players in the network"
            >
              <i className="fas fa-circle" />
              {nodeCount.toLocaleString()}
            </span>
            <span
              className={styles.stat}
              data-tooltip-id={GLOBAL_TOOLTIP_ID}
              data-tooltip-content="Number of connections in the network"
            >
              <i className="fas fa-link" />
              {edgeCount.toLocaleString()}
            </span>
          </div>

          <button
            className={styles.expandButton}
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Hide filters' : 'Show filters'}
          >
            <i
              className={`fas ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`}
            />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className={styles.expandedContent}>
          <div className={styles.controlsGrid}>
            <div className={styles.searchSection}>
              <label className={`${styles.controlLabel} ${styles.focusLabel}`}>
                Focus on Player
              </label>
              <form onSubmit={handleSearchSubmit} className={styles.searchForm}>
                <PlayerSearch
                  id="player-search-overlay"
                  label=""
                  value={searchValue}
                  onChange={(value) => setSearchValue(value)}
                  fluid
                />
                <button
                  type="submit"
                  className={styles.searchButton}
                  disabled={loading}
                >
                  <i className="fas fa-search" />
                </button>
              </form>
            </div>

            <div className={styles.modeSelector}>
              <label className={styles.controlLabel}>Mode</label>
              <RadioInput.Group
                name="challenge-mode-overlay"
                onChange={handleModeChange}
                compact
                joined
              >
                <RadioInput.Option
                  value="all"
                  id="mode-all-overlay"
                  label="All"
                  checked={filters.mode === undefined}
                />
                <RadioInput.Option
                  value={ChallengeMode.TOB_REGULAR}
                  id="mode-regular-overlay"
                  label="Regular"
                  checked={filters.mode === ChallengeMode.TOB_REGULAR}
                />
                <RadioInput.Option
                  value={ChallengeMode.TOB_HARD}
                  id="mode-hard-overlay"
                  label="Hard"
                  checked={filters.mode === ChallengeMode.TOB_HARD}
                />
              </RadioInput.Group>
            </div>

            <div className={styles.scaleSelector}>
              <label className={styles.controlLabel}>Team Size</label>
              <div className={styles.checkboxGroup}>
                {[2, 3, 4, 5].map((scale) => (
                  <Checkbox
                    key={scale}
                    label={
                      scale === 2 ? 'Duo' : scale === 3 ? 'Trio' : `${scale}s`
                    }
                    checked={filters.scale?.includes(scale) || false}
                    onChange={(checked) =>
                      handleScaleChange(scale.toString(), checked)
                    }
                  />
                ))}
              </div>
            </div>

            <div className={styles.connectionThreshold}>
              <label className={styles.controlLabel}>
                Min. Raids Together: {filters.minConnections || 5}
              </label>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={filters.minConnections || 5}
                onChange={(e) => handleMinConnectionsChange(e.target.value)}
                className={styles.slider}
              />
              <div className={styles.sliderLabels}>
                <span>5</span>
                <span>50+</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
