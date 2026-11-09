'use client';

import { useState, useCallback } from 'react';
import { ChallengeMode, ChallengeType } from '@blert/common';

import Checkbox from '@/components/checkbox';
import PlayerSearch from '@/components/player-search';
import RadioInput from '@/components/radio-input';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import { modeName, scaleNameAndColor } from '@/utils/challenge';

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

const NETWORK_TYPES = [
  { type: ChallengeType.TOB, label: 'ToB' },
  { type: ChallengeType.TFA, label: 'TFA' },
];

const TOB_MODES = [ChallengeMode.TOB_REGULAR, ChallengeMode.TOB_HARD];

function teamSizes(type?: ChallengeType): number[] {
  const maxScale = type === ChallengeType.TOB ? 5 : 8;
  return Array.from({ length: maxScale - 1 }, (_, i) => i + 2);
}

function scaleDisplay(type?: ChallengeType, scales?: number[]) {
  if (
    scales === undefined ||
    scales.length === 0 ||
    scales.length === teamSizes(type).length
  ) {
    return 'All scales';
  }
  return scales.map((scale) => scaleNameAndColor(scale)[0]).join(', ');
}

function typeDisplay(
  type?: ChallengeType,
  mode?: ChallengeMode,
): string | null {
  if (type === undefined) {
    return null;
  }
  if (mode !== undefined) {
    return modeName(type, mode);
  }
  return NETWORK_TYPES.find((t) => t.type === type)?.label ?? null;
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

  const handleTypeChange = useCallback(
    (value: string | number) => {
      const type: ChallengeType | undefined =
        value === 'all' ? undefined : parseInt(value.toString());
      const sizes = teamSizes(type);
      const scale = filters.scale?.filter((s) => sizes.includes(s));
      onFiltersChange({
        ...filters,
        type,
        mode: type === ChallengeType.TOB ? filters.mode : undefined,
        scale: scale !== undefined && scale.length > 0 ? scale : undefined,
      });
    },
    [filters, onFiltersChange],
  );

  const handleModeChange = useCallback(
    (value: string | number) => {
      const mode: ChallengeMode | undefined =
        value === 'all' ? undefined : parseInt(value.toString());
      onFiltersChange({
        ...filters,
        mode,
      });
    },
    [filters, onFiltersChange],
  );

  const handleScaleChange = useCallback(
    (scale: number, checked: boolean) => {
      const currentScales = filters.scale ?? [];

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

  const typeLabel = typeDisplay(filters.type, filters.mode);

  return (
    <div className={styles.controlsOverlay}>
      <div className={styles.collapsedHeader}>
        <div className={styles.headerLeft}>
          <div className={styles.titleSection}>
            <i className="fas fa-sliders-h" />
            <span className={styles.title}>Network Filters</span>
          </div>

          <div className={styles.filterSummary}>
            {typeLabel !== null && (
              <span className={styles.filterItem}>
                <i className="fas fa-trophy" />
                {typeLabel}
              </span>
            )}
            <span className={styles.filterItem}>
              <i className="fas fa-users" />
              {scaleDisplay(filters.type, filters.scale)}
            </span>
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
          <div className={styles.control}>
            <span className={styles.controlLabel}>Type</span>
            <RadioInput.Group
              name="challenge-type-overlay"
              onChange={handleTypeChange}
              compact
              joined
            >
              <RadioInput.Option
                value="all"
                id="type-all-overlay"
                label="All"
                checked={filters.type === undefined}
              />
              {NETWORK_TYPES.map(({ type, label }) => (
                <RadioInput.Option
                  key={type}
                  value={type}
                  id={`type-${type}-overlay`}
                  label={label}
                  checked={filters.type === type}
                />
              ))}
            </RadioInput.Group>
          </div>

          {filters.type === ChallengeType.TOB && (
            <div className={styles.control}>
              <span className={styles.controlLabel}>Mode</span>
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
                {TOB_MODES.map((mode) => (
                  <RadioInput.Option
                    key={mode}
                    value={mode}
                    id={`mode-${mode}-overlay`}
                    label={modeName(ChallengeType.TOB, mode, false)}
                    checked={filters.mode === mode}
                  />
                ))}
              </RadioInput.Group>
            </div>
          )}

          <div className={styles.control}>
            <span className={styles.controlLabel}>Size</span>
            {teamSizes(filters.type).map((scale) => (
              <Checkbox
                key={scale}
                label={scaleNameAndColor(scale)[0]}
                checked={filters.scale?.includes(scale) ?? false}
                onChange={(checked) => handleScaleChange(scale, checked)}
                simple
              />
            ))}
          </div>

          <div className={styles.control}>
            <label
              className={styles.controlLabel}
              htmlFor="min-connections-overlay"
            >
              Min. raids
            </label>
            <input
              id="min-connections-overlay"
              type="range"
              min="5"
              max="50"
              step="5"
              value={filters.minConnections ?? 5}
              onChange={(e) => handleMinConnectionsChange(e.target.value)}
              className={styles.slider}
            />
            <span className={styles.sliderValue}>
              {filters.minConnections ?? 5}
            </span>
          </div>

          <form
            onSubmit={handleSearchSubmit}
            className={`${styles.control} ${styles.searchForm}`}
          >
            <label
              className={styles.controlLabel}
              htmlFor="player-search-overlay"
            >
              Focus
            </label>
            <PlayerSearch
              id="player-search-overlay"
              label=""
              value={searchValue}
              onChange={(value) => setSearchValue(value)}
              width={180}
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
      )}
    </div>
  );
}
