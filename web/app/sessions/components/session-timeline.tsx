'use client';

import { ChallengeStatus } from '@blert/common';
import { useRouter } from 'next/navigation';
import { useRef, useState, useCallback, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
} from 'recharts';

import { SessionChallenge } from '@/actions/challenge';
import Card from '@/components/card';
import SectionTitle from '@/components/section-title';
import { useClientOnly } from '@/hooks/client-only';
import { challengeTerm, statusNameAndColor } from '@/utils/challenge';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { formatDuration } from '@/utils/time';
import { challengeUrl } from '@/utils/url';

import { useSessionContext } from './session-context-provider';

import styles from './session-timeline.module.scss';

function mins(ms: number): number {
  return ms / (1000 * 60);
}

/** A point on the timeline (either a challenge or a break in the session). */
type TimelineDataPoint = {
  /**
   * Chronological index of the point.
   * Breaks are represented by a 0.5 index between two challenges.
   */
  index: number;

  /**
   * The challenge that this point represents.
   * If null, this point represents a break.
   */
  challenge: SessionChallenge | null;

  /** Start time of the point in minutes from the start of the session. */
  startMinutes: number;

  /** The time in minutes from the start of the session that the point ends. */
  endMinutes: number;

  /** The duration of the point in minutes. */
  durationMinutes: number;

  /** The color of the point. */
  color: string;

  /** The width of the point in minutes. */
  baseWidth: number;
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
}

function CustomTooltip({ active = false, payload }: CustomTooltipProps) {
  if (!active || !payload || !payload[0]) {
    return null;
  }

  const data = payload[0].payload as TimelineDataPoint;

  if (!data.challenge) {
    return (
      <div className={styles.tooltip}>
        <div className={styles.tooltipHeader}>
          <i className="fas fa-minus" />
          <span>Break</span>
        </div>
        <div className={styles.tooltipBody}>
          <div className={styles.tooltipStat}>
            <span>Duration:</span>
            <span>{formatDuration(data.durationMinutes * 60 * 1000)}</span>
          </div>
        </div>
      </div>
    );
  }

  if (!data.challenge) {
    return null;
  }

  const challenge = data.challenge;
  const [statusString, statusColor] = statusNameAndColor(
    challenge.status,
    challenge.stage,
  );

  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHeader}>
        <span className={styles.challengeNumber}>
          {challengeTerm(challenge.type)} #{data.index}
        </span>
        <span className={styles.challengeStatus} style={{ color: statusColor }}>
          <i className={`fas ${statusIcon(challenge.status)}`} />
          {statusString}
        </span>
      </div>
      <div className={styles.tooltipBody}>
        <div className={styles.tooltipRow}>
          <div className={styles.tooltipStat}>
            <i className="fas fa-clock" />
            <span>Start:</span>
            <span>{formatTimeAxis(data.startMinutes)}</span>
          </div>
          <div className={styles.tooltipStat}>
            <i className="fas fa-hourglass" />
            <span>Duration:</span>
            <span className={styles.monospace}>
              {ticksToFormattedSeconds(challenge.challengeTicks)}
            </span>
          </div>
        </div>
        <div className={styles.tooltipRow}>
          <div className={styles.tooltipStat}>
            <i className="fas fa-skull" />
            <span>Deaths:</span>
            <span>{challenge.totalDeaths}</span>
          </div>
          {challenge.personalBests && challenge.personalBests.length > 0 && (
            <div className={styles.tooltipStat}>
              <i
                className="fas fa-star"
                style={{ color: 'var(--blert-gold)' }}
              />
              <span>PBs:</span>
              <span>{challenge.personalBests.length}</span>
            </div>
          )}
        </div>
      </div>
      <div className={styles.tooltipFooter}>
        <span>Click to view replay</span>
      </div>
    </div>
  );
}

function statusIcon(status: ChallengeStatus): string {
  switch (status) {
    case ChallengeStatus.COMPLETED:
      return 'fa-check';
    case ChallengeStatus.WIPED:
      return 'fa-x';
    case ChallengeStatus.RESET:
      return 'fa-undo';
    case ChallengeStatus.IN_PROGRESS:
      return 'fa-ellipsis';
    default:
      return 'fa-x';
  }
}

function statusColor(status: ChallengeStatus): string {
  const [, color] = statusNameAndColor(status);
  return color;
}

function formatTimeAxis(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);

  if (hours > 0) {
    return `${hours}h ${mins.toString().padStart(2, '0')}m`;
  }
  return `${mins}m`;
}

function TimelineSkeleton() {
  return (
    <div className={styles.skeletonContainer}>
      <div className={styles.skeletonBars}>
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className={styles.skeletonBar}
            style={{
              width: `${50 + 10 * i}%`,
              animationDelay: `${i * 200}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

const MIN_BAR_HEIGHT = 32;
const MIN_TIMELINE_HEIGHT = 300;
const MAX_TIMELINE_HEIGHT = 500;
const MIN_TIMELINE_WIDTH = 400;

export default function SessionTimeline() {
  const { session, isInitialLoad } = useSessionContext();
  const router = useRouter();

  const isClient = useClientOnly();
  const containerRef = useRef<HTMLDivElement>(null);
  const [horizontalZoom, setHorizontalZoom] = useState(100);
  const [verticalZoom, setVerticalZoom] = useState(100);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState({ left: 0, top: 0 });
  const [hasInitialized, setHasInitialized] = useState(false);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!containerRef.current) {
        return;
      }

      e.preventDefault();

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (e.shiftKey) {
        // If holding shift while scrolling, scroll horizontally.
        e.preventDefault();
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollLeft += e.deltaY;
          }
        });
        return;
      }

      // Calculate zoom factor (smaller steps for smoother zooming).
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;

      if (e.ctrlKey || e.metaKey) {
        // Horizontal zoom (time precision) - 100% to 500%.
        const newHorizontalZoom = Math.max(
          100,
          Math.min(500, horizontalZoom * zoomFactor),
        );

        const scrollX = container.scrollLeft;
        const zoomRatio = newHorizontalZoom / horizontalZoom;
        const newScrollX = (scrollX + mouseX) * zoomRatio - mouseX;

        setHorizontalZoom(newHorizontalZoom);

        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollLeft = newScrollX;
          }
        });
      } else {
        // Vertical zoom (challenge density) - 100% to 300%.
        const newVerticalZoom = Math.max(
          100,
          Math.min(300, verticalZoom * zoomFactor),
        );

        // Calculate new scroll position following the zoom.
        const scrollY = container.scrollTop;
        const zoomRatio = newVerticalZoom / verticalZoom;
        const newScrollY = (scrollY + mouseY) * zoomRatio - mouseY;

        setVerticalZoom(newVerticalZoom);

        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = newScrollY;
          }
        });
      }
    },
    [horizontalZoom, verticalZoom],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;

    // Only start drag if not clicking on a bar (to preserve click-to-navigate).
    const target = e.target as HTMLElement;
    if (target.closest('.recharts-bar-rectangle')) {
      return;
    }

    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setScrollStart({
      left: containerRef.current.scrollLeft,
      top: containerRef.current.scrollTop,
    });

    document.body.style.cursor = 'grabbing';
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) {
        return;
      }

      e.preventDefault();

      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;

      containerRef.current.scrollLeft = scrollStart.left - deltaX;
      containerRef.current.scrollTop = scrollStart.top - deltaY;
    },
    [isDragging, dragStart, scrollStart],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    document.body.style.cursor = '';
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    container.addEventListener('wheel', handleWheel, { passive: false });

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      container.removeEventListener('wheel', handleWheel);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleWheel, handleMouseMove, handleMouseUp, isDragging]);

  useEffect(() => {
    if (!hasInitialized && containerRef.current) {
      setHorizontalZoom(100);
      setVerticalZoom(100);
      setHasInitialized(true);
    }
  }, [hasInitialized, isClient]);

  useEffect(() => {
    if (!containerRef.current || !hasInitialized) {
      return;
    }

    // Trigger re-render when container size changes to update dimensions.
    const handleResize = () => {
      setHasInitialized(true);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, [hasInitialized, isClient]);

  if (isInitialLoad || !isClient) {
    return (
      <Card>
        <SectionTitle icon="fa-chart-gantt">Session Timeline</SectionTitle>
        <TimelineSkeleton />
      </Card>
    );
  }

  if (!session) {
    return (
      <Card>
        <SectionTitle icon="fa-chart-gantt">Session Timeline</SectionTitle>
        <div className={styles.errorState}>
          <i className="fas fa-exclamation-triangle" />
          <span>Failed to load timeline data</span>
        </div>
      </Card>
    );
  }

  const challengeLabel = challengeTerm(session.challengeType, true);

  if (session.challenges.length === 0) {
    return (
      <Card>
        <SectionTitle icon="fa-chart-gantt">Session Timeline</SectionTitle>
        <div className={styles.emptyState}>
          <i className="fas fa-timeline" />
          <span>No {challengeLabel.toLowerCase()} to display</span>
        </div>
      </Card>
    );
  }

  const sessionStartTime = session.startTime.getTime();
  const timelineData: TimelineDataPoint[] = [];

  let hasBreak = false;

  session.challenges.forEach((challenge, index) => {
    const challengeStartMs = challenge.startTime.getTime() - sessionStartTime;
    const startMinutes = mins(challengeStartMs);
    const durationMinutes = mins(
      (challenge.finishTime ?? new Date()).getTime() -
        challenge.startTime.getTime(),
    );

    if (index > 0) {
      // Check if there was a break between the previous challenge and this one.
      const prevChallenge = session.challenges[index - 1];
      const prevEndTime = prevChallenge.finishTime || prevChallenge.startTime;
      const breakDurationMinutes = mins(
        challenge.startTime.getTime() - prevEndTime.getTime(),
      );

      if (breakDurationMinutes > 15) {
        const breakStartMinutes = mins(
          prevEndTime.getTime() - sessionStartTime,
        );
        hasBreak = true;
        timelineData.push({
          index: index + 0.5, // Use fractional index for breaks.
          startMinutes: breakStartMinutes,
          durationMinutes: breakDurationMinutes,
          endMinutes: breakStartMinutes + breakDurationMinutes,
          challenge: null,
          color: 'rgba(var(--blert-text-color-base), 0.1)',
          baseWidth: breakStartMinutes,
        });
      }
    }

    timelineData.push({
      index: index + 1,
      challenge,
      startMinutes,
      durationMinutes,
      endMinutes: startMinutes + durationMinutes,
      color: statusColor(challenge.status),
      baseWidth: startMinutes,
    });
  });

  const sessionDuration =
    (session.endTime ?? new Date()).getTime() - session.startTime.getTime();

  const maxMinutes = Math.max(
    mins(sessionDuration),
    ...timelineData.map((d) => d.endMinutes),
  );

  const hasLiveChallenge = session.challenges.some(
    (c) => c.status === ChallengeStatus.IN_PROGRESS,
  );

  const calculatedHeight = Math.max(
    MIN_TIMELINE_HEIGHT,
    timelineData.length * MIN_BAR_HEIGHT + 60, // Pad for axes.
  );
  const needsScrolling = calculatedHeight > MAX_TIMELINE_HEIGHT;
  const timelineHeight = needsScrolling
    ? MAX_TIMELINE_HEIGHT
    : calculatedHeight;

  // Calculate base dimensions that fill the container, which will become the
  // 100% zoom baseline.
  // For width, use container width minus margins/padding
  // (1rem padding = 16px on each side, plus Y-axis width).
  const availableWidth = (containerRef.current?.clientWidth || 800) - 32 - 50;
  const baseChartWidth = Math.max(availableWidth, MIN_TIMELINE_WIDTH);

  // For height, ensure it fills the available space.
  const availableHeight = timelineHeight - 40; // Account for margins.
  const naturalChartHeight = timelineData.length * MIN_BAR_HEIGHT + 60;
  const baseChartHeight = Math.max(
    availableHeight,
    naturalChartHeight * Math.min(1, availableHeight / naturalChartHeight),
  );

  // Apply zoom from the 100% baseline.
  const chartWidth = baseChartWidth * (horizontalZoom / 100);
  const chartHeight = baseChartHeight * (verticalZoom / 100);

  const containerClasses = [
    styles.chartContainer,
    needsScrolling && styles.scrollableChart,
    isDragging && styles.dragging,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Card>
      <SectionTitle icon="fa-chart-gantt">Session Timeline</SectionTitle>

      <div className={styles.timelineHeader}>
        <div className={styles.timelineInfo}>
          <span className={styles.timelineLabel}>
            <i className="fas fa-clock" />
            Duration: {formatDuration(sessionDuration)}
          </span>
          <span className={styles.timelineLabel}>
            <i className="fas fa-list-ol" />
            {session.challenges.length} {challengeLabel.toLowerCase()}
          </span>
          {hasLiveChallenge && (
            <span className={styles.liveIndicator}>
              <span className={styles.pulsingDot} />
              Live
            </span>
          )}
          <span className={styles.zoomIndicator}>
            <i className="fas fa-search" />
            H:{Math.round(horizontalZoom)}% V:{Math.round(verticalZoom)}%
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className={containerClasses}
        style={{
          height: `${timelineHeight}px`,
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleMouseDown}
      >
        <BarChart
          data={timelineData}
          layout="vertical"
          width={chartWidth}
          height={chartHeight}
          margin={{ top: 20, right: 30, left: 50, bottom: 40 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255, 255, 255, 0.1)"
            horizontal={false}
          />
          <XAxis
            type="number"
            domain={[0, maxMinutes]}
            tickFormatter={formatTimeAxis}
            tick={{ fill: 'var(--blert-text-color)', fontSize: 12 }}
            tickCount={8}
            axisLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
            tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
            hide={session.challenges.length === 1}
          />
          <YAxis
            type="category"
            dataKey="index"
            width={50}
            tick={{ fill: 'var(--blert-text-color)', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
            tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
            tickFormatter={(value) => {
              const data = timelineData.find((d) => d.index === value);
              return data?.challenge === null ? '—' : `#${Math.floor(value)}`;
            }}
            hide={session.challenges.length === 1}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ fill: 'rgba(139, 92, 246, 0.1)' }}
          />

          {/* Invisible base bars for positioning. */}
          <Bar
            dataKey="baseWidth"
            fill="transparent"
            stroke="none"
            stackId="timeline"
          />

          {/* Main timeline bars. */}
          <Bar
            dataKey="durationMinutes"
            radius={[0, 2, 2, 0]}
            stroke="rgba(0, 0, 0, 0.2)"
            strokeWidth={1}
            cursor="pointer"
            stackId="timeline"
            onClick={(data: any) => {
              if (!isDragging && data.challenge !== null) {
                router.push(
                  challengeUrl(session.challengeType, data.challenge.uuid),
                );
              }
            }}
            className={styles.timelineBar}
          >
            {timelineData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>

          {/* Live edge pulse for in-progress challenges. */}
          {timelineData.map((data, i) => {
            if (
              data.challenge !== null &&
              data.challenge.status === ChallengeStatus.IN_PROGRESS
            ) {
              return (
                <ReferenceLine
                  key={`live-${i}`}
                  x={data.endMinutes}
                  stroke="var(--blert-blue)"
                  strokeWidth={2}
                  className={styles.liveEdge}
                />
              );
            }
            return null;
          })}
        </BarChart>
      </div>

      <div className={styles.timelineFooter}>
        <div className={styles.legendItems}>
          <div className={styles.legendItem}>
            <div
              className={styles.legendColor}
              style={{ background: statusColor(ChallengeStatus.COMPLETED) }}
            ></div>
            <span>Completed</span>
          </div>
          <div className={styles.legendItem}>
            <div
              className={styles.legendColor}
              style={{ background: statusColor(ChallengeStatus.WIPED) }}
            ></div>
            <span>Wipe</span>
          </div>
          <div className={styles.legendItem}>
            <div
              className={styles.legendColor}
              style={{ background: statusColor(ChallengeStatus.RESET) }}
            ></div>
            <span>Reset</span>
          </div>
          {hasLiveChallenge && (
            <div className={styles.legendItem}>
              <div
                className={styles.legendColor}
                style={{
                  background: statusColor(ChallengeStatus.IN_PROGRESS),
                }}
              ></div>
              <span>In Progress</span>
            </div>
          )}
          {hasBreak && (
            <div className={styles.legendItem}>
              <div
                className={styles.legendColor}
                style={{
                  background: 'rgba(var(--blert-text-color-base), 0.1)',
                }}
              ></div>
              <span>Break</span>
            </div>
          )}
        </div>
        <div className={styles.timelineHint}>
          <i className="fas fa-info-circle" />
          <span>
            Drag to pan • Wheel: vertical zoom • Ctrl+Wheel: horizontal zoom •
            Click bars to view {challengeLabel.toLowerCase()}
          </span>
        </div>
      </div>
    </Card>
  );
}
