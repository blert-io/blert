'use client';

import { useState, useEffect, useCallback } from 'react';

import BloatHandsControls, { BloatHandsFilters, DisplayMode } from './controls';
import BloatHandsStats from './stats';
import BloatHandsVisualizer from './visualizer';

import styles from './style.module.scss';

export type BloatHandsView = 'total' | 'wave' | 'chunk' | 'intraChunkOrder';

export type BloatHandsData = {
  totalChallenges: number;
  totalHands: number;
  data:
    | { view: 'total'; byTile: Record<string, number> }
    | { view: 'wave'; byWave: Record<string, Record<string, number>> }
    | { view: 'chunk'; byChunk: Record<string, number> }
    | {
        view: 'intraChunkOrder';
        byOrder: Record<string, Record<string, number>>;
      };
};

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.errorState}>
      <div className={styles.errorIcon}>
        <i className="fas fa-exclamation-circle" />
      </div>
      <div className={styles.errorContent}>
        <h3>Failed to load bloat hand data</h3>
        <p>There was a problem fetching the spawn pattern analysis.</p>
      </div>
      <button onClick={onRetry} className={styles.retryButton}>
        <i className="fas fa-sync-alt" /> Try Again
      </button>
    </div>
  );
}

function SkeletonVisualizer() {
  return (
    <div className={styles.skeletonVisualizer}>
      <div className={styles.skeletonGrid}>
        {Array.from({ length: 256 }).map((_, i) => (
          <div key={i} className={styles.skeletonTile} />
        ))}
      </div>
      <div className={styles.skeletonLegend}>
        <div className={styles.skeletonText}>
          <div className={styles.skeletonLine} style={{ width: '60%' }} />
        </div>
      </div>
    </div>
  );
}

function SkeletonStats() {
  return (
    <div className={styles.skeletonStats}>
      <div className={styles.skeletonStatCard}>
        <div className={styles.skeletonText}>
          <div className={styles.skeletonLine} style={{ width: '80%' }} />
          <div className={styles.skeletonLine} style={{ width: '60%' }} />
        </div>
      </div>
      <div className={styles.skeletonStatCard}>
        <div className={styles.skeletonText}>
          <div className={styles.skeletonLine} style={{ width: '70%' }} />
          <div className={styles.skeletonLine} style={{ width: '90%' }} />
          <div className={styles.skeletonLine} style={{ width: '50%' }} />
        </div>
      </div>
    </div>
  );
}

function ErrorStatsPlaceholder() {
  return (
    <div className={styles.errorStatsPlaceholder}>
      <div className={styles.placeholderCard}>
        <h3>About This Analysis</h3>
        <p>
          This tool visualizes where Bloat’s hands spawn across thousands of
          Theatre of Blood raids, helping you understand spawn patterns.
        </p>
      </div>
      <div className={styles.placeholderCard}>
        <h3>What You’ll See</h3>
        <ul>
          <li>
            <strong>Heat Map:</strong> Color-coded spawn frequency by tile
          </li>
          <li>
            <strong>Statistics:</strong> Spawn counts and percentages
          </li>
          <li>
            <strong>Filters:</strong> Filter by mode, date, and spawn order
          </li>
        </ul>
      </div>
    </div>
  );
}

export default function BloatHands() {
  const [hoveredTile, setHoveredTile] = useState<number | null>(null);
  const [selectedTile, setSelectedTile] = useState<number | null>(null);
  const [data, setData] = useState<BloatHandsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('percentage');

  const [filters, setFilters] = useState<BloatHandsFilters>({
    mode: undefined,
    intraChunkOrder: undefined,
    startDate: null,
    endDate: null,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('view', 'total');
      if (filters.mode !== undefined) {
        params.set('mode', filters.mode.toString());
      }
      if (filters.intraChunkOrder !== undefined) {
        params.set('intraChunkOrder', filters.intraChunkOrder);
      }

      if (filters.startDate !== null && filters.endDate !== null) {
        const endDate = new Date(filters.endDate);
        endDate.setDate(endDate.getDate() + 1);
        params.set(
          'startTime',
          `${filters.startDate.getTime()}..${endDate.getTime()}`,
        );
      } else if (filters.startDate !== null) {
        params.set('startTime', `ge${filters.startDate.getTime()}`);
      } else if (filters.endDate !== null) {
        const endDate = new Date(filters.endDate);
        endDate.setDate(endDate.getDate() + 1);
        params.set('startTime', `lt${filters.endDate.getTime()}`);
      }

      const response = await fetch(`/api/v1/trends/bloat-hands?${params}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('No data found for the specified filters');
        }
        throw new Error(`Failed to fetch data: ${response.status}`);
      }

      const result = (await response.json()) as BloatHandsData;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleTileHover = (tileId: number | null) => {
    setHoveredTile(tileId);
  };

  const handleTileClick = (tileId: number | null) => {
    setSelectedTile(tileId);
  };

  const handleDisplayModeChange = (mode: DisplayMode) => {
    setDisplayMode(mode);
    setSelectedTile(null);
  };

  return (
    <>
      <div className={styles.controlsSection}>
        <BloatHandsControls
          filters={filters}
          setFilters={setFilters}
          displayMode={displayMode}
          onDisplayModeChange={handleDisplayModeChange}
          loading={loading}
        />
      </div>

      <div className={styles.contentGrid}>
        <div className={styles.visualizerSection}>
          {error ? (
            <ErrorState onRetry={() => void fetchData()} />
          ) : loading || !data ? (
            <SkeletonVisualizer />
          ) : (
            <BloatHandsVisualizer
              data={data}
              displayMode={displayMode}
              hoveredTile={hoveredTile}
              selectedTile={selectedTile}
              onTileHover={handleTileHover}
              onTileClick={handleTileClick}
            />
          )}
        </div>

        <div className={styles.statsSection}>
          {error ? (
            <ErrorStatsPlaceholder />
          ) : loading || !data ? (
            <SkeletonStats />
          ) : (
            <BloatHandsStats
              data={data}
              displayMode={displayMode}
              filters={filters}
            />
          )}
        </div>
      </div>
    </>
  );
}
