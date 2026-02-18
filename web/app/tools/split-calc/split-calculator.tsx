'use client';

import { ChallengeMode, adjustSplitForMode } from '@blert/common';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import Card from '@/components/card';
import Checkbox from '@/components/checkbox';
import RadioInput from '@/components/radio-input';
import TickInput from '@/components/tick-input';
import { useToast } from '@/components/toast';
import { ticksToFormattedSeconds } from '@/utils/tick';

import { optimizeAllocation } from './allocation';
import { DistributionChart } from './distribution-chart';
import {
  convolveDistributions,
  convolvedPercentile,
  formatPercentile,
  percentile,
  targetProbability,
} from './probability';
import { ProbabilityHero } from './probability-hero';
import { RoomInput } from './room-input';
import {
  DistributionBin,
  RoomDefinition,
  SplitDistribution,
  RoomState,
  SplitTier,
  TOB_MODES,
  TOB_ROOMS,
  TOB_SCALES,
} from './types';

import styles from './style.module.scss';

/**
 * Quantizes distribution bins to a tick cycle by flooring each bin's ticks
 * to the nearest multiple and merging counts.
 */
function quantizeBins(
  dist: SplitDistribution,
  cycle: number,
): SplitDistribution {
  const merged = new Map<number, number>();
  for (const bin of dist.bins) {
    const quantized = Math.floor(bin.ticks / cycle) * cycle;
    merged.set(quantized, (merged.get(quantized) ?? 0) + bin.count);
  }
  const bins: DistributionBin[] = Array.from(merged.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ticks, count]) => ({ ticks, count }));
  return { ...dist, bins };
}

const MODE_ID_MAP: Record<number, string> = {
  [ChallengeMode.TOB_REGULAR]: 'reg',
  [ChallengeMode.TOB_HARD]: 'hm',
};

const MODE_FROM_ID: Record<string, ChallengeMode> = {
  reg: ChallengeMode.TOB_REGULAR,
  hm: ChallengeMode.TOB_HARD,
};

function initialRoomState(): Record<string, RoomState> {
  const state: Record<string, RoomState> = {};
  for (const room of TOB_ROOMS) {
    state[room.key] = { ticks: null, source: 'user', locked: false };
  }
  return state;
}

function parseQueryState(params: URLSearchParams): {
  mode: ChallengeMode;
  scale: number;
  tier: SplitTier;
  target: number | null;
  rooms: Record<string, RoomState>;
} {
  const modeStr = params.get('mode') ?? 'reg';
  const mode = MODE_FROM_ID[modeStr] ?? ChallengeMode.TOB_REGULAR;
  const scaleStr = params.get('scale');
  let scale = scaleStr !== null ? parseInt(scaleStr) : 5;
  if (scale < 1 || scale > 5 || isNaN(scale)) {
    scale = 5;
  }

  const tierStr = params.get('tier');
  let tier = SplitTier.STANDARD;
  if (tierStr === SplitTier.SPEEDRUN) {
    tier = SplitTier.SPEEDRUN;
  }

  const targetStr = params.get('target');
  let target: number | null = null;
  if (targetStr !== null) {
    const parsed = parseInt(targetStr);
    if (!isNaN(parsed) && parsed > 0) {
      target = parsed;
    }
  }

  const rooms = initialRoomState();
  for (const room of TOB_ROOMS) {
    const ticksStr = params.get(room.key);
    if (ticksStr !== null) {
      const ticks = parseInt(ticksStr);
      if (!isNaN(ticks) && ticks > 0) {
        rooms[room.key] = { ticks, source: 'user', locked: true };
      }
    }
  }

  return { mode, scale, tier, target, rooms };
}

function buildQueryString(
  mode: ChallengeMode,
  scale: number,
  tier: SplitTier,
  target: number | null,
  rooms: Record<string, RoomState>,
): string {
  const params = new URLSearchParams();
  params.set('mode', MODE_ID_MAP[mode] ?? 'reg');
  params.set('scale', scale.toString());
  if (tier === SplitTier.SPEEDRUN) {
    params.set('tier', tier);
  }
  if (target !== null) {
    params.set('target', target.toString());
  }
  for (const room of TOB_ROOMS) {
    const state = rooms[room.key];
    if (state.ticks !== null && state.source !== 'computed') {
      params.set(room.key, state.ticks.toString());
    }
  }
  return params.toString();
}

export function SplitCalculator() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showToast = useToast();

  // Parse initial state from URL.
  const initial = useMemo(() => parseQueryState(searchParams), [searchParams]);

  const [mode, setMode] = useState<ChallengeMode>(initial.mode);
  const [scale, setScale] = useState<number>(initial.scale);
  const [tier, setTier] = useState<SplitTier>(initial.tier);
  const [rooms, setRooms] = useState<Record<string, RoomState>>(initial.rooms);
  const [targetTicks, setTargetTicks] = useState<number | null>(initial.target);
  const [distributions, setDistributions] = useState<
    Record<number, SplitDistribution>
  >({});
  const [distributionsLoading, setDistributionsLoading] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<string>(TOB_ROOMS[0].key);
  const [targetEditing, setTargetEditing] = useState(false);
  const targetWrapperRef = useRef<HTMLDivElement>(null);

  // Track whether we need to update the URL.
  const urlUpdateRef = useRef(false);
  // Ensure only the latest distributions request updates state.
  const distributionsRequestIdRef = useRef(0);

  useEffect(() => {
    if (!urlUpdateRef.current) {
      urlUpdateRef.current = true;
      return;
    }
    const qs = buildQueryString(mode, scale, tier, targetTicks, rooms);
    router.replace(`?${qs}`, { scroll: false });
  }, [mode, scale, tier, targetTicks, rooms, router]);

  useEffect(() => {
    const requestId = distributionsRequestIdRef.current + 1;
    distributionsRequestIdRef.current = requestId;
    let cancelled = false;

    const fetchDistributions = async () => {
      const splitTypes = TOB_ROOMS.map((room) =>
        adjustSplitForMode(room.splitType, mode),
      );

      const params = new URLSearchParams();
      params.set('types', splitTypes.join(','));
      params.set('scale', scale.toString());
      if (tier !== SplitTier.STANDARD || scale >= 3) {
        params.set('tier', tier);
      }

      setDistributionsLoading(true);
      try {
        const res = await fetch(
          `/api/v1/splits/distributions?${params.toString()}`,
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as SplitDistribution[];

        // Build a map from mode-adjusted split type to tick cycle.
        const cycleByType = new Map<number, number>();
        for (const room of TOB_ROOMS) {
          if (room.tickCycle !== undefined) {
            cycleByType.set(
              adjustSplitForMode(room.splitType, mode),
              room.tickCycle,
            );
          }
        }

        const byType: Record<number, SplitDistribution> = {};
        for (const d of data) {
          const cycle = cycleByType.get(d.splitType);
          byType[d.splitType] =
            cycle !== undefined ? quantizeBins(d, cycle) : d;
        }
        if (cancelled || distributionsRequestIdRef.current !== requestId) {
          return;
        }
        setDistributions(byType);
      } catch {
        if (cancelled || distributionsRequestIdRef.current !== requestId) {
          return;
        }
        showToast('Failed to load distribution data.', 'error');
        setDistributions({});
      } finally {
        if (!cancelled && distributionsRequestIdRef.current === requestId) {
          setDistributionsLoading(false);
        }
      }
    };
    void fetchDistributions();

    return () => {
      cancelled = true;
    };
  }, [mode, scale, tier, showToast]);

  const getDistribution = useCallback(
    (room: RoomDefinition) => {
      const modeType = adjustSplitForMode(room.splitType, mode);
      return distributions[modeType] ?? null;
    },
    [mode, distributions],
  );

  const lockedSum = Object.values(rooms).reduce(
    (sum, state) =>
      state.locked && state.ticks !== null ? sum + state.ticks : sum,
    0,
  );
  const hasUnlockedRooms = TOB_ROOMS.some((r) => !rooms[r.key].locked);
  const targetBudget = targetTicks !== null ? targetTicks - lockedSum : null;

  // Optimize allocation for unlocked rooms.
  const allocation = useMemo(() => {
    if (targetBudget === null || targetBudget <= 0 || !hasUnlockedRooms) {
      return null;
    }

    const unlocked: { key: string; bins: DistributionBin[]; total: number }[] =
      [];
    for (const room of TOB_ROOMS) {
      if (rooms[room.key].locked) {
        continue;
      }
      const dist = getDistribution(room);
      if (dist === null || dist.total === 0) {
        return null;
      }
      unlocked.push({ key: room.key, bins: dist.bins, total: dist.total });
    }

    return optimizeAllocation(unlocked, targetBudget);
  }, [targetBudget, rooms, getDistribution, hasUnlockedRooms]);

  // Merge optimizer results into room state for display.
  const effectiveRooms = useMemo(() => {
    if (allocation === null) {
      return rooms;
    }

    const result = { ...rooms };
    for (const alloc of allocation) {
      result[alloc.key] = {
        ticks: alloc.ticks,
        source: 'computed',
        locked: false,
      };
    }
    return result;
  }, [rooms, allocation]);

  const overallTicks = useMemo(() => {
    let sum = 0;
    let allNull = true;
    for (const room of TOB_ROOMS) {
      const state = effectiveRooms[room.key];
      if (state.ticks !== null) {
        sum += state.ticks;
        allNull = false;
      }
    }
    return allNull ? null : sum;
  }, [effectiveRooms]);

  // Convolve unlocked room distributions for probability and confidence interval.
  const convolutionResult = useMemo(() => {
    const roomsWithData: { bins: DistributionBin[]; total: number }[] = [];
    let fixedSum = 0;

    for (const room of TOB_ROOMS) {
      const state = rooms[room.key];
      if (state.locked && state.ticks !== null) {
        fixedSum += state.ticks;
        continue;
      }
      const dist = getDistribution(room);
      if (dist === null || dist.total === 0) {
        return null;
      }
      roomsWithData.push({ bins: dist.bins, total: dist.total });
    }

    if (roomsWithData.length === 0) {
      return { fixedSum, convolved: null };
    }

    // Use a generous maxSum for the convolution so percentiles are accurate.
    const maxConv = roomsWithData.reduce(
      (max, r) => max + r.bins[r.bins.length - 1].ticks,
      0,
    );
    const convolved = convolveDistributions(roomsWithData, maxConv);
    return { fixedSum, convolved };
  }, [rooms, getDistribution]);

  const overallProbability = useMemo(() => {
    if (targetTicks === null || convolutionResult === null) {
      return null;
    }
    const { fixedSum, convolved } = convolutionResult;
    const remaining = targetTicks - fixedSum;
    if (remaining <= 0) {
      return remaining === 0 && convolved === null ? 1 : 0;
    }
    if (convolved === null) {
      return 1;
    }
    return targetProbability(convolved, remaining);
  }, [targetTicks, convolutionResult]);

  // 90% confidence interval for overall time.
  const confidenceInterval = useMemo(() => {
    if (convolutionResult === null) {
      return null;
    }
    const { fixedSum, convolved } = convolutionResult;
    if (convolved === null) {
      return null;
    }
    const p5 = convolvedPercentile(convolved, 0.05);
    const p95 = convolvedPercentile(convolved, 0.95);
    if (p5 === null || p95 === null) {
      return null;
    }
    return [fixedSum + p5, fixedSum + p95] as [number, number];
  }, [convolutionResult]);

  // Selected room distribution stats.
  const selectedDist = useMemo(() => {
    const room = TOB_ROOMS.find((r) => r.key === selectedRoom);
    if (room === null || room === undefined) {
      return null;
    }
    return getDistribution(room);
  }, [selectedRoom, getDistribution]);

  const distStats = useMemo(() => {
    if (selectedDist === null || selectedDist.bins.length === 0) {
      return null;
    }
    const { bins, total } = selectedDist;
    const min = bins[0].ticks;
    const max = bins[bins.length - 1].ticks;

    let sum = 0;
    for (const bin of bins) {
      sum += bin.ticks * bin.count;
    }
    const mean = sum / total;

    // Median: find the tick where cumulative count >= total / 2.
    let cumulative = 0;
    let median = min;
    const half = total / 2;
    for (const bin of bins) {
      cumulative += bin.count;
      if (cumulative >= half) {
        median = bin.ticks;
        break;
      }
    }

    return { min, max, mean, median, total };
  }, [selectedDist]);

  function handleRoomTicksChange(key: string, ticks: number | null) {
    setRooms((prev) => ({
      ...prev,
      [key]: {
        ticks,
        source: 'user' as const,
        locked: ticks !== null ? true : prev[key].locked,
      },
    }));
  }

  function handleRoomConfirm(key: string, ticks: number | null) {
    setRooms((prev) => ({
      ...prev,
      [key]: {
        ticks,
        source: 'user' as const,
        locked: ticks !== null ? true : prev[key].locked,
      },
    }));

    // Focus the next room's input.
    const index = TOB_ROOMS.findIndex((r) => r.key === key);
    if (index >= 0 && index < TOB_ROOMS.length - 1) {
      const nextKey = TOB_ROOMS[index + 1].key;
      const nextInput = document.getElementById(`room-${nextKey}`);
      nextInput?.focus();
    }
  }

  function handleLockToggle(key: string) {
    setRooms((prev) => {
      const wasLocked = prev[key].locked;
      if (wasLocked) {
        return { ...prev, [key]: { ...prev[key], locked: false } };
      }
      const effective = effectiveRooms[key];
      return {
        ...prev,
        [key]: {
          ticks: effective.ticks,
          source: 'user' as const,
          locked: true,
        },
      };
    });
  }

  function handleModeChange(value: number | string) {
    setMode(value as ChallengeMode);
  }

  function handleScaleChange(value: number | string) {
    const newScale = value as number;
    setScale(newScale);
    if (newScale < 3 && tier === SplitTier.SPEEDRUN) {
      setTier(SplitTier.STANDARD);
    }
  }

  function handleTierToggle() {
    setTier((prev) =>
      prev === SplitTier.STANDARD ? SplitTier.SPEEDRUN : SplitTier.STANDARD,
    );
  }

  // Percentile for selected room.
  const selectedRoomState = effectiveRooms[selectedRoom];
  const selectedPct =
    selectedRoomState.ticks !== null &&
    selectedDist !== null &&
    selectedDist.total > 0
      ? percentile(
          selectedDist.bins,
          selectedDist.total,
          selectedRoomState.ticks,
        )
      : null;

  return (
    <>
      {/* Config bar */}
      <Card>
        <div className={styles.configBar}>
          <div className={styles.configGroup}>
            <span className={styles.configLabel}>Mode</span>
            <RadioInput.Group
              name="mode"
              onChange={handleModeChange}
              compact
              joined
            >
              {TOB_MODES.map((m) => (
                <RadioInput.Option
                  key={m.mode}
                  id={`mode-${m.mode}`}
                  label={m.label}
                  value={m.mode}
                  checked={mode === m.mode}
                />
              ))}
            </RadioInput.Group>
          </div>
          <div className={styles.configGroup}>
            <span className={styles.configLabel}>Scale</span>
            <RadioInput.Group
              name="scale"
              onChange={handleScaleChange}
              compact
              joined
            >
              {TOB_SCALES.map((s) => (
                <RadioInput.Option
                  key={s}
                  id={`scale-${s}`}
                  label={s.toString()}
                  value={s}
                  checked={scale === s}
                />
              ))}
            </RadioInput.Group>
          </div>
          {scale >= 3 && (
            <Checkbox
              label="1-down bloat"
              checked={tier === SplitTier.SPEEDRUN}
              onChange={() => handleTierToggle()}
              simple
            />
          )}
        </div>
      </Card>

      {/* Room inputs */}
      <Card
        header={{
          title: 'Room Splits',
          action: (
            <button
              className={styles.clearButton}
              onClick={() => setRooms(initialRoomState())}
              type="button"
            >
              <i className="fas fa-eraser" /> Clear all
            </button>
          ),
        }}
      >
        <div className={styles.roomsGrid}>
          {TOB_ROOMS.map((room) => (
            <RoomInput
              key={room.key}
              room={room}
              state={effectiveRooms[room.key]}
              distribution={getDistribution(room)}
              loading={distributionsLoading}
              infeasible={
                targetBudget !== null &&
                targetBudget > 0 &&
                allocation === null &&
                !rooms[room.key].locked
              }
              onTicksChange={(ticks) => handleRoomTicksChange(room.key, ticks)}
              onConfirm={(ticks) => handleRoomConfirm(room.key, ticks)}
              onLockToggle={() => handleLockToggle(room.key)}
            />
          ))}
        </div>
        <div className={styles.usageHints}>
          <span>
            <kbd>Enter</kbd> to confirm &amp; jump to next room
          </span>
          •
          <span>
            <i className="fas fa-lock" /> locked rooms keep their value
          </span>
          •
          <span>
            <i className="fas fa-lock-open" /> unlocked rooms can be auto-filled
          </span>
        </div>
        <div className={styles.overallRow}>
          <span className={styles.overallLabel}>Total time</span>
          <span className={styles.overallTime}>
            {overallTicks !== null
              ? ticksToFormattedSeconds(overallTicks)
              : '-:--.-'}
          </span>
        </div>
      </Card>

      {/* Target & probability */}
      <Card header={{ title: 'Target Time' }}>
        <div className={styles.targetSection}>
          <div
            className={styles.targetGroup}
            ref={targetWrapperRef}
            onFocus={() => setTargetEditing(true)}
            onBlur={(e) => {
              if (
                !targetWrapperRef.current?.contains(e.relatedTarget as Node)
              ) {
                setTargetEditing(false);
              }
            }}
          >
            <TickInput
              id="target"
              label="Target time"
              inputMode="time"
              ticks={targetEditing ? undefined : targetTicks}
              onChange={(ticks) => setTargetTicks(ticks)}
            />
          </div>
          <ProbabilityHero
            probability={overallProbability}
            confidenceInterval={confidenceInterval}
            overshoot={
              targetBudget !== null && targetBudget < 0
                ? Math.abs(targetBudget)
                : 0
            }
            infeasible={
              targetBudget !== null &&
              targetBudget > 0 &&
              hasUnlockedRooms &&
              allocation === null
            }
            loading={distributionsLoading}
          />
        </div>
      </Card>

      {/* Distribution chart */}
      <Card header={{ title: 'Distribution' }}>
        <div className={styles.distributionSection}>
          <div className={styles.roomTabs}>
            <RadioInput.Group
              name="dist-room"
              onChange={(value) => setSelectedRoom(value as string)}
              compact
              joined
            >
              {TOB_ROOMS.map((room) => (
                <RadioInput.Option
                  key={room.key}
                  id={`dist-${room.key}`}
                  label={room.label}
                  value={room.key}
                  checked={selectedRoom === room.key}
                />
              ))}
            </RadioInput.Group>
          </div>
          {distributionsLoading ? (
            <div className={styles.loading}>
              <i className="fas fa-spinner" />
              Loading distributions&hellip;
            </div>
          ) : selectedDist === null || selectedDist.bins.length === 0 ? (
            <div className={styles.noData}>
              No recorded data for this mode/scale combination
            </div>
          ) : (
            <>
              <DistributionChart
                bins={selectedDist.bins}
                referenceTicks={selectedRoomState.ticks}
                tickCycle={
                  TOB_ROOMS.find((r) => r.key === selectedRoom)?.tickCycle
                }
              />
              {distStats !== null && (
                <div className={styles.statsRow}>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Min</span>
                    <span className={styles.statValue}>
                      {ticksToFormattedSeconds(distStats.min)}
                    </span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Median</span>
                    <span className={styles.statValue}>
                      {ticksToFormattedSeconds(distStats.median)}
                    </span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Mean</span>
                    <span className={styles.statValue}>
                      {ticksToFormattedSeconds(Math.round(distStats.mean))}
                    </span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Max</span>
                    <span className={styles.statValue}>
                      {ticksToFormattedSeconds(distStats.max)}
                    </span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Samples</span>
                    <span className={styles.statValue}>
                      {distStats.total.toLocaleString()}
                    </span>
                  </div>
                  {selectedPct !== null && (
                    <div className={styles.statItem}>
                      <span className={styles.statLabel}>Percentile</span>
                      <span className={styles.statValue}>
                        {formatPercentile(selectedPct)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </>
  );
}
