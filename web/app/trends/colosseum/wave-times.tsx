'use client';

import { SplitType, splitName } from '@blert/common';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConnectedPlayer } from '@/actions/users';
import DistributionChart from '@/components/distribution-chart';
import PercentileChart from '@/components/percentile-chart';
import PlayerSearch from '@/components/player-search';
import RadioInput from '@/components/radio-input';
import Statistic from '@/components/statistic';
import { useToast } from '@/components/toast';
import { distributionStats } from '@/utils/probability';
import { ticksToFormattedSeconds } from '@/utils/tick';

import {
  COLOSSEUM_WAVE_SPLITS,
  Distribution,
  WavePercentiles,
  attachPlayerMarks,
  playerWaveMarks,
  sixMonthsAgo,
  wavesToCategories,
} from './data';

import styles from './style.module.scss';

type TimeWindow = 'all' | '6m';

const WAVE_TYPES_PARAM = COLOSSEUM_WAVE_SPLITS.join(',');

function windowParam(window: TimeWindow): string {
  return window === '6m' ? `&after=${sixMonthsAgo().toISOString()}` : '';
}

export default function WaveTimes({
  connectedPlayers,
}: {
  connectedPlayers: ConnectedPlayer[];
}) {
  const defaultPlayer = connectedPlayers[0]?.username ?? null;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const paramPlayer = searchParams.get('player');
  const initialPlayer =
    paramPlayer !== null && paramPlayer !== '' ? paramPlayer : defaultPlayer;

  const showToast = useToast();

  const [timeWindow, setTimeWindow] = useState<TimeWindow>('6m');
  const [data, setData] = useState<WavePercentiles[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const hasDataRef = useRef(false);

  const [playerInput, setPlayerInput] = useState(initialPlayer ?? '');
  const [player, setPlayer] = useState<string | null>(initialPlayer);
  const [playerDistributions, setPlayerDistributions] = useState<
    Distribution[] | null
  >(null);

  const [globalBins, setGlobalBins] = useState<Distribution[] | null>(null);
  const [binsError, setBinsError] = useState(false);
  const binsAbortRef = useRef<AbortController | null>(null);
  const [selectedWave, setSelectedWave] = useState<SplitType | null>(() => {
    const wave = parseInt(searchParams.get('wave') ?? '', 10);
    return wave >= 1 && wave <= 12
      ? SplitType.COLOSSEUM_WAVE_1 + wave - 1
      : null;
  });
  const [drillDownClosing, setDrillDownClosing] = useState(false);

  const updateQueryParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === null) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      if (params.toString() !== searchParams.toString()) {
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, {
          scroll: false,
        });
      }
    },
    [router, pathname, searchParams],
  );

  const setWaveParam = useCallback(
    (splitType: SplitType | null) => {
      updateQueryParam(
        'wave',
        splitType === null
          ? null
          : (splitType - SplitType.COLOSSEUM_WAVE_1 + 1).toString(),
      );
    },
    [updateQueryParam],
  );

  // Previously loaded data is kept visible while a new time window loads.
  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/v1/splits/percentiles?types=${WAVE_TYPES_PARAM}` +
          `&scale=1${windowParam(timeWindow)}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      setData((await response.json()) as WavePercentiles[]);
      hasDataRef.current = true;
      setLoading(false);
    } catch {
      if (controller.signal.aborted) {
        return;
      }
      setLoading(false);
      if (hasDataRef.current) {
        showToast('Failed to update wave times.', 'error');
      } else {
        setError(true);
      }
    }
  }, [timeWindow, showToast]);

  useEffect(() => {
    void loadData();
    return () => abortRef.current?.abort();
  }, [loadData]);

  useEffect(() => {
    if (player === null) {
      setPlayerDistributions(null);
      return;
    }

    let cancelled = false;
    fetch(
      `/api/v1/splits/distributions/query?party=${encodeURIComponent(player)}` +
        `&types=${WAVE_TYPES_PARAM}&scale=1${windowParam(timeWindow)}`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((distributions: Distribution[] | null) => {
        if (!cancelled) {
          setPlayerDistributions(distributions);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerDistributions(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [player, timeWindow]);

  const loadGlobalBins = useCallback(async () => {
    binsAbortRef.current?.abort();
    const controller = new AbortController();
    binsAbortRef.current = controller;

    setBinsError(false);
    try {
      const response = await fetch(
        `/api/v1/splits/distributions?types=${WAVE_TYPES_PARAM}&scale=1`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      setGlobalBins((await response.json()) as Distribution[]);
    } catch {
      if (!controller.signal.aborted) {
        setBinsError(true);
      }
    }
  }, []);

  useEffect(() => {
    return () => binsAbortRef.current?.abort();
  }, []);

  const needsGlobalBins =
    selectedWave !== null || (player !== null && timeWindow === '6m');
  useEffect(() => {
    if (needsGlobalBins && globalBins === null && !binsError) {
      void loadGlobalBins();
    }
  }, [needsGlobalBins, globalBins, binsError, loadGlobalBins]);

  // Standings compare against the global distributions, whose window is
  // fixed at six months, so they are omitted for other time windows.
  const playerMarks = useMemo(() => {
    const sampleCounts = new Map(
      data?.map((d) => [d.splitType, d.count]) ?? [],
    );
    return playerWaveMarks(
      playerDistributions ?? [],
      timeWindow === '6m' ? globalBins : null,
      sampleCounts,
    );
  }, [playerDistributions, globalBins, timeWindow, data]);

  const categories = useMemo(() => {
    if (data === null) {
      return [];
    }
    return attachPlayerMarks(wavesToCategories(data), playerMarks);
  }, [data, playerMarks]);

  const selectPlayer = useCallback(
    (username: string) => {
      setPlayerInput(username);
      setPlayer(username);
      setPlayerDistributions(null);
      updateQueryParam('player', username);
    },
    [updateQueryParam],
  );

  const clearPlayer = useCallback(() => {
    setPlayerInput('');
    setPlayer(null);
    setPlayerDistributions(null);
    updateQueryParam('player', null);
  }, [updateQueryParam]);

  if (error) {
    return (
      <div className={styles.errorState}>
        <i className={`fa-solid fa-triangle-exclamation ${styles.errorIcon}`} />
        <div className={styles.errorContent}>
          <h3>Failed to load wave times</h3>
          <p>Something went wrong fetching Colosseum data.</p>
        </div>
        <button className={styles.retryButton} onClick={() => void loadData()}>
          <i className="fa-solid fa-rotate-right" />
          Retry
        </button>
      </div>
    );
  }

  if (data === null) {
    return <div className={styles.skeletonChart} />;
  }

  if (categories.length === 0) {
    return (
      <div className={styles.emptyState}>
        No Colosseum runs have been recorded yet.
      </div>
    );
  }

  const selectedBins =
    selectedWave !== null
      ? (globalBins?.find((d) => d.splitType === selectedWave) ?? null)
      : null;
  const selectedStats =
    selectedBins !== null
      ? distributionStats(selectedBins.bins, selectedBins.total)
      : null;

  return (
    <div className={styles.waveTimes}>
      <div className={styles.controls}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Filters</h3>
          <div className={styles.filterRow}>
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Time period</span>
              <div className={styles.windowRadio}>
                <RadioInput.Group
                  name="colo-time-window"
                  compact
                  joined
                  onChange={(value) => setTimeWindow(value as TimeWindow)}
                >
                  <RadioInput.Option
                    value="6m"
                    id="colo-window-6m"
                    label="Last 6 months"
                    checked={timeWindow === '6m'}
                  />
                  <RadioInput.Option
                    value="all"
                    id="colo-window-all"
                    label="All time"
                    checked={timeWindow === 'all'}
                  />
                </RadioInput.Group>
              </div>
            </div>
            <div className={styles.playerControl}>
              <PlayerSearch
                id="colo-player-search"
                label="Compare player"
                value={playerInput}
                onChange={setPlayerInput}
                onSelection={selectPlayer}
                width={180}
              />
              {player !== null && (
                <button
                  className={styles.closeButton}
                  onClick={clearPlayer}
                  aria-label="Clear player"
                >
                  <i className="fa-solid fa-xmark" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <div
        className={`${styles.chartWrapper} ${
          loading && data !== null ? styles.refreshing : ''
        }`}
      >
        <PercentileChart
          categories={categories}
          title="Wave completion times"
          playerName={player ?? undefined}
          selectedKey={selectedWave}
          onCategoryClick={(key) => {
            if (key === selectedWave) {
              setDrillDownClosing(true);
            } else {
              setSelectedWave(key as SplitType);
              setDrillDownClosing(false);
              setWaveParam(key as SplitType);
            }
          }}
        />
      </div>
      {selectedWave === null && (
        <div className={styles.drillDownHint}>
          <i className="fa-solid fa-hand-pointer" />
          Click a wave in the chart to see its full time distribution.
        </div>
      )}
      {selectedWave !== null && (
        <div
          className={`${styles.drillDown} ${
            drillDownClosing ? styles.closing : ''
          }`}
          onAnimationEnd={() => {
            if (drillDownClosing) {
              setSelectedWave(null);
              setDrillDownClosing(false);
              setWaveParam(null);
            }
          }}
        >
          <div className={styles.drillDownHeader}>
            <h3>{splitName(selectedWave)} time distribution</h3>
            <button
              className={styles.closeButton}
              onClick={() => setDrillDownClosing(true)}
              aria-label="Close distribution"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          {binsError ? (
            <div className={styles.emptyState}>
              Failed to load the wave&apos;s distribution.
              <button
                className={styles.retryButton}
                onClick={() => void loadGlobalBins()}
              >
                <i className="fa-solid fa-rotate-right" />
                Retry
              </button>
            </div>
          ) : globalBins === null ? (
            <div className={styles.skeletonChart} />
          ) : (
            <>
              <div className={styles.drillDownChart}>
                <DistributionChart
                  bins={selectedBins?.bins ?? []}
                  referenceTicks={playerMarks.get(selectedWave)?.median ?? null}
                />
              </div>
              {selectedStats !== null && (
                <div className={styles.statsRow}>
                  <Statistic
                    name="Min"
                    value={ticksToFormattedSeconds(selectedStats.min)}
                    simple
                    width={110}
                  />
                  <Statistic
                    name="Median"
                    value={ticksToFormattedSeconds(selectedStats.median)}
                    simple
                    width={110}
                  />
                  <Statistic
                    name="Mean"
                    value={ticksToFormattedSeconds(
                      Math.round(selectedStats.mean),
                    )}
                    simple
                    width={110}
                  />
                  <Statistic
                    name="Max"
                    value={ticksToFormattedSeconds(selectedStats.max)}
                    simple
                    width={110}
                  />
                  <Statistic
                    name="Samples"
                    value={selectedStats.total}
                    simple
                    width={110}
                  />
                </div>
              )}
              <p className={styles.drillDownNote}>
                Based on runs from the last 6 months. Times above the 90th
                percentile are not shown.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
