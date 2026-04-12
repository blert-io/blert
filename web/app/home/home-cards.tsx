'use client';

import {
  ActivityFeedItemType,
  Challenge,
  ChallengeMode,
  challengeName,
  ChallengeStatus,
  ChallengeType,
  SplitType,
  stageName,
} from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactTimeago, { Unit } from 'react-timeago';

import { ActivityFeedItem, ChallengeEndFeedItem } from '@/actions/activity';
import { PlayerWithCurrentUsername, RankedSplit } from '@/actions/challenge';
import { SetupListItem } from '@/actions/setup';
import ActivityChart from '@/components/activity-chart';
import Card, { CardLink } from '@/components/card';
import Carousel from '@/components/carousel';
import RadioInput from '@/components/radio-input';
import { challengeLogo } from '@/logo';
import { useClientOnly } from '@/hooks/client-only';
import { challengeTerm } from '@/utils/challenge';
import { challengePartyNames } from '@/utils/challenge-description';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl, queryString } from '@/utils/url';

import styles from './style.module.scss';

const DEFAULT_REFRESH_INTERVAL = 30 * 1000;

const enum LocalStorageKey {
  SELECTED_CHALLENGE = 'home-selected-challenge',
  STATS_TIME_PERIOD = 'home-stats-time-period',
  LEADERBOARD_TIME_PERIOD = 'home-leaderboard-time-period',
  ACTIVITY_FILTER = 'home-activity-filter',
}

const SUPPORTED_CHALLENGES = [
  ChallengeType.TOB,
  ChallengeType.COLOSSEUM,
  ChallengeType.INFERNO,
  ChallengeType.MOKHAIOTL,
] as const;

type SupportedChallenge = (typeof SUPPORTED_CHALLENGES)[number];

type ChallengeInfo = {
  flavorBefore: string;
  name: string;
  description: string;
  hubUrl: string;
  browseText: string;
  leaderboardSplit: SplitType;
  leaderboardScales: number[];
  leaderboardUrl: string;
  color: string;
  colorEnd: string;
  image?: string;
};

const CHALLENGE_INFO: Record<SupportedChallenge, ChallengeInfo> = {
  [ChallengeType.TOB]: {
    flavorBefore: 'Enter the',
    name: 'Theatre of Blood',
    description:
      'Replay every crab spawn, Nylo wave, maze, and everything in between ' +
      'from Maiden to Verzik.',
    hubUrl: '/raids/tob',
    browseText: 'Browse Raids',
    leaderboardSplit: SplitType.TOB_REG_CHALLENGE,
    leaderboardScales: [5, 4, 3, 2],
    leaderboardUrl: '/leaderboards/tob',
    color: '#d4ba2b',
    colorEnd: '#e8a020',
  },
  [ChallengeType.COLOSSEUM]: {
    flavorBefore: 'Conquer the',
    name: 'Colosseum',
    description:
      'Track modifier choices, solve pillar stacks, and analyze each wave as ' +
      'you fight your way to Sol Heredit.',
    hubUrl: '/challenges/colosseum',
    browseText: 'Browse Runs',
    leaderboardSplit: SplitType.COLOSSEUM_CHALLENGE,
    leaderboardScales: [1],
    leaderboardUrl: '/leaderboards/colosseum',
    color: '#33a4af',
    colorEnd: '#58c8b8',
  },
  [ChallengeType.INFERNO]: {
    flavorBefore: 'Survive the',
    name: 'Inferno',
    description:
      'Break down wave spawns, positioning, and prayer flicks from the ' +
      'moment you enter the Inferno to Zuk.',
    hubUrl: '/challenges/inferno',
    browseText: 'Browse Runs',
    leaderboardSplit: SplitType.INFERNO_CHALLENGE,
    leaderboardScales: [1],
    leaderboardUrl: '/leaderboards/inferno',
    color: '#a14f1a',
    colorEnd: '#d4783a',
  },
  [ChallengeType.MOKHAIOTL]: {
    flavorBefore: 'Face the',
    name: 'Doom of Mokhaiotl',
    description:
      'Follow each delve as you descend into the ruins, tracking every orb, ' +
      'larva, and acid splat as the room shrinks around you.',
    hubUrl: '/challenges/mokhaiotl',
    browseText: 'Browse Runs',
    leaderboardSplit: SplitType.MOKHAIOTL_CHALLENGE,
    leaderboardScales: [1],
    leaderboardUrl: '/leaderboards/mokhaiotl',
    color: '#c16056',
    colorEnd: '#d98a7a',
  },
};

function scaleName(scale: number) {
  switch (scale) {
    case 1:
      return 'Solo';
    case 2:
      return 'Duo';
    case 3:
      return 'Trio';
    default:
      return `${scale}-player`;
  }
}

const enum TimePeriod {
  DAY,
  WEEK,
  MONTH,
  ALL,
}

function startOfTimePeriod(period: TimePeriod): Date {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  switch (period) {
    case TimePeriod.WEEK:
      start.setDate(start.getDate() - 7);
      break;
    case TimePeriod.MONTH:
      start.setMonth(start.getMonth() - 1);
      break;
    case TimePeriod.ALL:
      return new Date(0);
  }
  return start;
}

type ChallengeSelectorProps = {
  selected: SupportedChallenge;
  onSelect: (type: SupportedChallenge) => void;
};

function ChallengeSelector({ selected, onSelect }: ChallengeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [uniquePlayers, setUniquePlayers] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const info = CHALLENGE_INFO[selected];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current !== null &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    setTotalCount(null);
    setUniquePlayers(null);

    const controller = new AbortController();
    const params = queryString({ type: selected });

    fetch(`/api/v1/challenges/stats?${params}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (res.ok) {
          return res.json() as Promise<{ '*': { count: number } }>;
        }
        throw new Error('Failed to fetch total count');
      })
      .then((data) => {
        setTotalCount(data['*'].count);
      })
      .catch(() => {
        // Ignore API errors as stats are just decorative.
      });

    fetch(`/api/v1/challenges/stats/players?${params}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (res.ok) {
          return res.json() as Promise<{ count: number }>;
        }
        throw new Error('Failed to fetch unique players');
      })
      .then((data) => {
        setUniquePlayers(data.count);
      })
      .catch(() => {
        // Ignore API errors as stats are just decorative.
      });

    return () => controller.abort();
  }, [selected]);

  const term = challengeTerm(selected, true).toLowerCase();

  return (
    <div
      className={styles.challengeSelectorWrap}
      style={
        {
          '--challenge-color': info.color,
          '--challenge-color-end': info.colorEnd,
        } as React.CSSProperties
      }
    >
      <Card primary className={styles.challengeSelector}>
        <div className={styles.selectorHeader}>
          <span className={styles.flavorText}>{info.flavorBefore}</span>
          <div className={styles.dropdown} ref={dropdownRef}>
            <button
              className={styles.dropdownToggle}
              onClick={() => setOpen(!open)}
            >
              <span>{info.name}</span>
              <i
                className={`fas fa-chevron-down ${styles.dropdownCaret} ${open ? styles.open : ''}`}
              />
            </button>
            {open && (
              <div className={styles.dropdownMenu}>
                {SUPPORTED_CHALLENGES.map((type) => (
                  <button
                    key={type}
                    className={`${styles.dropdownItem} ${type === selected ? styles.active : ''}`}
                    onClick={() => {
                      onSelect(type);
                      setOpen(false);
                    }}
                  >
                    <span
                      className={styles.dropdownDot}
                      style={{ background: CHALLENGE_INFO[type].color }}
                    />
                    {CHALLENGE_INFO[type].name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.selectorBody}>
          <div className={styles.selectorImage}>
            <Image
              src={info.image ?? challengeLogo(selected)}
              alt={info.name}
              width={72}
              height={72}
              style={{ objectFit: 'contain' }}
            />
          </div>
          <p className={styles.challengeDescription}>{info.description}</p>
        </div>
        <div className={styles.selectorStats}>
          {totalCount !== null && (
            <div className={styles.selectorStat}>
              <span className={styles.selectorStatValue}>
                {totalCount.toLocaleString()}
              </span>
              <span className={styles.selectorStatLabel}>{term} recorded</span>
            </div>
          )}
          {uniquePlayers !== null && (
            <div className={styles.selectorStat}>
              <span className={`${styles.selectorStatValue} ${styles.muted}`}>
                {uniquePlayers.toLocaleString()}
              </span>
              <span className={styles.selectorStatLabel}>players tracked</span>
            </div>
          )}
        </div>

        <Link href={info.hubUrl} className={styles.selectorCta}>
          {info.browseText} <i className="fas fa-arrow-right" />
        </Link>
      </Card>
    </div>
  );
}

type Stats = {
  total: number;
  completions: number;
  mostPopularScale: {
    scale: number;
    percentage: number;
  };
  avgCompletionTicks: number | null;
};

type GroupedCount = Record<number, { '*': { count: number } }>;

type ChallengeStatsProps = {
  challengeType: SupportedChallenge;
};

function ChallengeStatsCard({ challengeType }: ChallengeStatsProps) {
  const term = challengeTerm(challengeType, true);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    completions: 0,
    mostPopularScale: { scale: 0, percentage: 0 },
    avgCompletionTicks: null,
  });
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(TimePeriod.DAY);

  useEffect(() => {
    const storedTimePeriod = window.localStorage.getItem(
      LocalStorageKey.STATS_TIME_PERIOD,
    );
    if (storedTimePeriod !== null) {
      setTimePeriod(parseInt(storedTimePeriod) as TimePeriod);
    }
  }, []);

  const changeTimePeriod = useCallback((period: TimePeriod) => {
    setTimePeriod(period);
    window.localStorage.setItem(
      LocalStorageKey.STATS_TIME_PERIOD,
      period.toString(),
    );
  }, []);

  const fetchStats = useCallback(
    async (signal?: AbortSignal) => {
      const start = startOfTimePeriod(timePeriod);
      const filterParams = queryString({
        type: challengeType,
        startTime: `ge${start.getTime()}`,
      });

      try {
        const [scalePayload, statusPayload, avgPayload] = await Promise.all([
          fetch(`/api/v1/challenges/stats?${filterParams}&group=scale`, {
            signal,
          }).then((res) => res.json() as Promise<GroupedCount>),
          fetch(`/api/v1/challenges/stats?${filterParams}&group=status`, {
            signal,
          }).then((res) => res.json() as Promise<GroupedCount>),
          fetch(
            `/api/v1/challenges/stats?${filterParams}&status=${ChallengeStatus.COMPLETED}&aggregate=challengeTicks:avg`,
            { signal },
          ).then(
            (res) =>
              res.json() as Promise<{
                '*': { count: number };
                challengeTicks?: { avg: number };
              }>,
          ),
        ]);

        const totalChallenges = Object.values(scalePayload).reduce(
          (acc, curr) => acc + curr['*'].count,
          0,
        );

        let mostPopularScale = 0;
        let mostPopularScaleCount = 0;
        for (const [scale, result] of Object.entries(scalePayload)) {
          if (result['*'].count > mostPopularScaleCount) {
            mostPopularScale = parseInt(scale);
            mostPopularScaleCount = result['*'].count;
          }
        }

        setStats({
          total: totalChallenges,
          completions:
            statusPayload[ChallengeStatus.COMPLETED]?.['*'].count ?? 0,
          mostPopularScale: {
            scale: mostPopularScale,
            percentage:
              totalChallenges > 0
                ? (mostPopularScaleCount / totalChallenges) * 100
                : 0,
          },
          avgCompletionTicks: avgPayload.challengeTicks?.avg ?? null,
        });
      } catch {
        // Ignore API errors as stats will refresh.
      }
    },
    [challengeType, timePeriod],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchStats(controller.signal);
    const interval = setInterval(
      () => void fetchStats(controller.signal),
      DEFAULT_REFRESH_INTERVAL,
    );
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchStats]);

  const hasMultipleScales =
    CHALLENGE_INFO[challengeType].leaderboardScales.length > 1;

  return (
    <Card
      header={{
        title: 'Stats',
        action: (
          <RadioInput.Group
            name="time-selector"
            className={styles.filters}
            onChange={(value) => changeTimePeriod(value as TimePeriod)}
            compact
            joined
          >
            <RadioInput.Option
              value={TimePeriod.DAY}
              id="time-selector-day"
              label="Day"
              checked={timePeriod === TimePeriod.DAY}
            />
            <RadioInput.Option
              value={TimePeriod.WEEK}
              id="time-selector-week"
              label="Week"
              checked={timePeriod === TimePeriod.WEEK}
            />
            <RadioInput.Option
              value={TimePeriod.MONTH}
              id="time-selector-month"
              label="Month"
              checked={timePeriod === TimePeriod.MONTH}
            />
          </RadioInput.Group>
        ),
      }}
    >
      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.value}>{stats.total}</span>
          <span className={styles.label}>{term}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.value}>{stats.completions}</span>
          <span className={styles.label}>Completions</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.value}>
            {stats.total > 0
              ? ((stats.completions / stats.total) * 100).toFixed(1)
              : '0.0'}
            %
          </span>
          <span className={styles.label}>Comp. Rate</span>
        </div>
      </div>
      <div className={styles.quickStats}>
        {hasMultipleScales ? (
          <div className={styles.quickStat}>
            <i className="fas fa-person-running" />
            <span>
              {stats.mostPopularScale.scale === 0
                ? `No ${term.toLowerCase()} completed`
                : `Top scale: ${scaleName(stats.mostPopularScale.scale)} ` +
                  `(${stats.mostPopularScale.percentage.toFixed(1)}% of ${term.toLowerCase()})`}
            </span>
          </div>
        ) : (
          stats.avgCompletionTicks !== null && (
            <div className={styles.quickStat}>
              <i className="fas fa-clock" />
              <span>
                {stats.avgCompletionTicks === 0
                  ? `No ${term.toLowerCase()} completed`
                  : `Avg. completion: ${ticksToFormattedSeconds(Math.round(stats.avgCompletionTicks))}`}
              </span>
            </div>
          )
        )}
      </div>
      <ActivityChartWrapper challengeType={challengeType} />
    </Card>
  );
}

function ActivityChartWrapper({
  challengeType,
}: {
  challengeType: SupportedChallenge;
}) {
  const [activityData, setActivityData] = useState<{
    startHour: number;
    data: { hour: number; count: number }[];
  }>({
    startHour: new Date().getUTCHours(),
    data: [],
  });

  const fetchData = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const params = queryString({ type: challengeType });
        const res = await fetch(`/api/activity/players?${params}`, { signal });
        const payload = (await res.json()) as number[];
        setActivityData({
          startHour: new Date().getUTCHours(),
          data: payload.map((p, i) => ({ hour: i, count: p })),
        });
      } catch {
        // Ignore API errors as stats will refresh.
      }
    },
    [challengeType],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchData(controller.signal);
    const interval = setInterval(
      () => void fetchData(controller.signal),
      DEFAULT_REFRESH_INTERVAL,
    );
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchData]);

  return (
    <ActivityChart
      data={activityData.data}
      icon="fas fa-users"
      title="Active Players"
      timeRange="Last 24h"
      valueLabel="players"
      height={100}
      startHour={activityData.startHour}
    />
  );
}

type LeaderboardEntry = {
  rank: number;
  time: number;
  party: PlayerWithCurrentUsername[];
  uuid: string;
  date: Date;
  tieCount?: number;
};

type ScaleLeaderboard = {
  scale: number;
  entries: LeaderboardEntry[];
};

type LeaderboardCardProps = {
  challengeType: SupportedChallenge;
};

const CAROUSEL_WIDTH = 320;

function Leaderboard({
  leaderboard,
  challengeType,
}: {
  leaderboard: ScaleLeaderboard;
  challengeType: SupportedChallenge;
}) {
  const isClient = useClientOnly();
  const info = CHALLENGE_INFO[challengeType];
  const hasMultipleScales = info.leaderboardScales.length > 1;

  return (
    <div className={styles.leaderboardList} style={{ width: CAROUSEL_WIDTH }}>
      {hasMultipleScales && (
        <h3 className={styles.carouselTitle}>{scaleName(leaderboard.scale)}</h3>
      )}
      <div className={styles.leaderboardEntries}>
        {leaderboard.entries.length > 0 ? (
          leaderboard.entries.map((entry) => (
            <Link
              key={entry.uuid}
              href={challengeUrl(challengeType, entry.uuid)}
              className={styles.leaderboardEntry}
            >
              <div className={styles.date}>
                {isClient && <ReactTimeago date={entry.date} />}
              </div>
              <div className={styles.topRow}>
                <div className={styles.rank}>
                  <span
                    className={`${styles.medal} ${
                      entry.rank === 1
                        ? styles.gold
                        : entry.rank === 2
                          ? styles.silver
                          : entry.rank === 3
                            ? styles.bronze
                            : ''
                    }`}
                  >
                    {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉'}
                  </span>
                  {entry.rank}
                </div>
                <div className={styles.timeRow}>
                  <span className={styles.time}>
                    {ticksToFormattedSeconds(entry.time)}
                  </span>
                  {entry.tieCount !== undefined && entry.tieCount > 0 && (
                    <span className={styles.tieBadge}>
                      <i className="fas fa-users" />+{entry.tieCount}
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.partyInfo}>
                <div className={styles.party}>
                  {entry.party.map((p) => p.username).join(', ')}
                </div>
              </div>
            </Link>
          ))
        ) : (
          <div className={styles.emptyState}>
            <i className="fas fa-trophy" />
            <p>No completions recorded in this time period.</p>
            <p>Record your next run to be first on the leaderboard!</p>
          </div>
        )}
        <CardLink href={info.leaderboardUrl} text="View Full Leaderboards" />
      </div>
    </div>
  );
}

function LeaderboardCard({ challengeType }: LeaderboardCardProps) {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(TimePeriod.DAY);
  const [leaderboards, setLeaderboards] = useState<ScaleLeaderboard[]>([]);
  const info = CHALLENGE_INFO[challengeType];
  const hasMultipleScales = info.leaderboardScales.length > 1;

  useEffect(() => {
    const storedTimePeriod = window.localStorage.getItem(
      LocalStorageKey.LEADERBOARD_TIME_PERIOD,
    );
    if (storedTimePeriod !== null) {
      setTimePeriod(parseInt(storedTimePeriod) as TimePeriod);
    }
  }, []);

  const changeTimePeriod = useCallback((period: TimePeriod) => {
    setTimePeriod(period);
    window.localStorage.setItem(
      LocalStorageKey.LEADERBOARD_TIME_PERIOD,
      period.toString(),
    );
  }, []);

  const fetchLeaderboards = useCallback(
    async (signal?: AbortSignal) => {
      const params = {
        splits: [info.leaderboardSplit],
        limit: 3,
        from: startOfTimePeriod(timePeriod).getTime(),
      };

      try {
        type LeaderboardResponse = Record<SplitType, RankedSplit[]>;
        const responses = await Promise.all(
          info.leaderboardScales.map((scale) =>
            fetch(`/api/v1/leaderboards?${queryString({ ...params, scale })}`, {
              signal,
            }).then((res) => res.json() as Promise<LeaderboardResponse>),
          ),
        );

        const leaderboards = responses.map((res, i) => ({
          scale: info.leaderboardScales[i],
          entries: (res[info.leaderboardSplit] ?? []).map((entry, j) => ({
            rank: j + 1,
            time: entry.ticks,
            party: entry.party,
            uuid: entry.uuid,
            date: entry.date,
            tieCount: entry.tieCount,
          })),
        }));

        setLeaderboards(leaderboards);
      } catch {
        // Ignore API errors as stats will refresh.
      }
    },
    [info, timePeriod],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchLeaderboards(controller.signal);
    const interval = setInterval(
      () => void fetchLeaderboards(controller.signal),
      DEFAULT_REFRESH_INTERVAL * 5,
    );
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchLeaderboards]);

  return (
    <Card
      header={{
        title: 'Top Times',
        action: (
          <RadioInput.Group
            name="leaderboard-time-selector"
            className={styles.filters}
            onChange={(value) => changeTimePeriod(value as TimePeriod)}
            compact
            joined
          >
            <RadioInput.Option
              value={TimePeriod.DAY}
              id="leaderboard-time-selector-day"
              label="Day"
              checked={timePeriod === TimePeriod.DAY}
            />
            <RadioInput.Option
              value={TimePeriod.MONTH}
              id="leaderboard-time-selector-month"
              label="Month"
              checked={timePeriod === TimePeriod.MONTH}
            />
            <RadioInput.Option
              value={TimePeriod.ALL}
              id="leaderboard-time-selector-all"
              label="All Time"
              checked={timePeriod === TimePeriod.ALL}
            />
          </RadioInput.Group>
        ),
      }}
    >
      <div className={styles.carousel}>
        {hasMultipleScales ? (
          leaderboards.length > 0 ? (
            <Carousel
              itemWidth={CAROUSEL_WIDTH}
              autoCycle
              cycleDuration={11300}
              showArrows={false}
            >
              {leaderboards.map((leaderboard) => (
                <div key={leaderboard.scale}>
                  <Leaderboard
                    leaderboard={leaderboard}
                    challengeType={challengeType}
                  />
                </div>
              ))}
            </Carousel>
          ) : (
            <div className={styles.emptyState}>
              <i className="fas fa-trophy" />
              <p>No leaderboards found for this period</p>
            </div>
          )
        ) : (
          leaderboards.length > 0 && (
            <Leaderboard
              leaderboard={leaderboards[0]}
              challengeType={challengeType}
            />
          )
        )}
      </div>
    </Card>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.feedError}>
      <div className={styles.errorIcon}>
        <i className="fas fa-exclamation-circle" />
      </div>
      <div className={styles.errorContent}>
        <h3>Failed to load activity feed</h3>
        <p>There was a problem fetching the latest activity.</p>
      </div>
      <button onClick={onRetry} className={styles.retryButton}>
        <i className="fas fa-sync-alt" /> Try Again
      </button>
    </div>
  );
}

function LoadingFeedItem() {
  return (
    <div className={`${styles.feedItem} ${styles.loading}`}>
      <div className={`${styles.feedIcon} ${styles.skeleton}`} />
      <div className={styles.feedContent}>
        <div className={styles.skeletonText}>
          <div className={styles.skeletonLine} style={{ width: '80%' }} />
        </div>
      </div>
      <div className={`${styles.feedTime} ${styles.skeleton}`} />
    </div>
  );
}

function FeedItem({ item, index }: { item: ActivityFeedItem; index: number }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => {
      setMounted(true);
    });

    return () => {
      setMounted(false);
    };
  }, []);

  let icon = '';
  let content: React.ReactNode;
  let href: string = '';

  switch (item.type) {
    case ActivityFeedItemType.CHALLENGE_END: {
      const challenge = (item as ChallengeEndFeedItem).challenge;
      let name: string = challengeName(challenge.type);
      let status: string = '';

      href = challengeUrl(challenge.type, challenge.uuid);

      if (challenge.type === ChallengeType.TOB) {
        if (challenge.mode === ChallengeMode.TOB_HARD) {
          name += ' (HM)';
        } else if (challenge.mode === ChallengeMode.TOB_ENTRY) {
          name += ' (Entry)';
        }
      }

      switch (challenge.status) {
        case ChallengeStatus.COMPLETED:
          icon = `fa-solid fa-flag-checkered ${styles.challengeCompleted}`;
          status = 'completed';
          break;
        case ChallengeStatus.RESET:
          icon = `fa-solid fa-rotate-left ${styles.challengeReset}`;
          status = `reset after ${stageName(challenge.stage)}`;
          break;
        case ChallengeStatus.WIPED:
          icon = `fa-solid fa-skull ${styles.challengeWiped}`;
          status = `wiped at ${stageName(challenge.stage)}`;
          break;
      }

      content = (
        <span>
          <strong>{challengePartyNames(challenge as Challenge)}</strong>{' '}
          {status}
          {challenge.status === ChallengeStatus.COMPLETED ? ' a ' : ' in a '}
          {challenge.scale > 1 &&
            `${scaleName(challenge.scale).toLowerCase()} `}
          {name}
          {challenge.status === ChallengeStatus.COMPLETED && (
            <>
              {' in '}
              <strong>
                {ticksToFormattedSeconds(challenge.challengeTicks)}
              </strong>
            </>
          )}
        </span>
      );
      break;
    }
  }

  return (
    <Link
      href={href}
      className={`${styles.feedItem} ${mounted ? styles.newItem : ''}`}
      style={
        {
          '--item-index': index,
        } as React.CSSProperties
      }
    >
      <div className={styles.feedIcon}>
        <i className={icon} />
      </div>
      <div className={styles.feedContent}>{content}</div>
      <span className={styles.feedTime}>
        <ReactTimeago
          date={item.time}
          formatter={(value: number, unit: Unit) => `${value}${unit[0]} ago`}
        />
      </span>
    </Link>
  );
}

function feedKeys(feed: ActivityFeedItem[]) {
  return feed.map((item) => item.time.getTime().toString()).join(',');
}

type ActivityFeedProps = {
  limit?: number;
  initialFeed?: ActivityFeedItem[];
};

export function ActivityFeed({
  limit = 5,
  initialFeed = [],
}: ActivityFeedProps) {
  const [feed, setFeed] = useState<ActivityFeedItem[]>(initialFeed);
  const feedItemKeys = useRef<string>(feedKeys(initialFeed));
  const [initialLoading, setInitialLoading] = useState(
    initialFeed.length === 0,
  );
  const [error, setError] = useState(false);

  const fetchActivity = useCallback(async () => {
    try {
      setError(false);
      const res = await fetch(`/api/activity/feed?limit=${limit}`);
      if (!res.ok) {
        throw new Error(`Fetch failed with status ${res.status}`);
      }
      type RawFeedItem = Omit<ActivityFeedItem, 'time'> & { time: string };
      const rawData = (await res.json()) as RawFeedItem[];
      const data: ActivityFeedItem[] = rawData.map((item) => ({
        ...item,
        time: new Date(item.time),
      }));

      if (feedKeys(data) !== feedItemKeys.current) {
        setFeed(data);
        feedItemKeys.current = feedKeys(data);
      }

      setInitialLoading(false);
    } catch {
      setError(true);
      setInitialLoading(true);
    }
  }, [limit]);

  useEffect(() => {
    void fetchActivity();
    const interval = setInterval(
      () => void fetchActivity(),
      DEFAULT_REFRESH_INTERVAL,
    );
    return () => clearInterval(interval);
  }, [fetchActivity]);

  return (
    <Card header={{ title: 'Live Activity' }} className={styles.activityFeed}>
      <div className={styles.feedItems}>
        {error ? (
          <ErrorState onRetry={() => void fetchActivity()} />
        ) : initialLoading ? (
          <>
            {Array.from({ length: limit }).map((_, i) => (
              <LoadingFeedItem key={i} />
            ))}
          </>
        ) : (
          feed.map((item, i) => (
            <FeedItem key={item.time.getTime()} item={item} index={i} />
          ))
        )}
      </div>
    </Card>
  );
}

type GuideCardItem = {
  title: string;
  description: string;
  href: string;
  updatedAt?: Date;
  guideType?: string;
  score?: number;
  views?: number;
  author?: string;
};

const SHOWCASE_GUIDES: GuideCardItem[] = [
  {
    title: 'ToB Plugin Setup',
    description: 'Recommended RuneLite plugins and optimal settings',
    href: '/guides/tob/plugins',
    guideType: 'Theatre of Blood',
    updatedAt: new Date('2025-02-24'),
  },
  {
    title: 'Trio Nylocas Waves',
    description: 'Complete strategy for 3-player teams',
    href: '/guides/tob/nylocas/trio',
    guideType: 'Theatre of Blood',
    updatedAt: new Date('2025-02-24'),
  },
];

export function GuidesCard() {
  const [setups, setSetups] = useState<GuideCardItem[]>([]);

  const fetchSetups = useCallback(async () => {
    try {
      const res = await fetch('/api/setups?limit=2&sort=score');
      const data = (await res.json()) as { setups: SetupListItem[] };
      setSetups(
        data.setups.map((setup) => ({
          title: setup.name,
          description: '',
          href: `/setups/${setup.publicId}`,
          updatedAt: setup.updatedAt ? new Date(setup.updatedAt) : undefined,
          score: setup.score,
          views: setup.views,
          author: setup.author,
        })),
      );
    } catch {
      // Ignore API errors as stats will refresh.
    }
  }, []);

  useEffect(() => {
    void fetchSetups();
    const interval = setInterval(
      () => void fetchSetups(),
      DEFAULT_REFRESH_INTERVAL,
    );
    return () => clearInterval(interval);
  }, [fetchSetups]);

  return (
    <div className={styles.communityGrid}>
      <Card header={{ title: 'Browse Guides' }} className={styles.guidesPanel}>
        <div className={styles.communityList}>
          {SHOWCASE_GUIDES.map((item, i) => (
            <Link key={i} href={item.href} className={styles.guideItem}>
              <span className={styles.guideTitle}>
                <i className="fas fa-book" />
                {item.title}
              </span>
              <div className={styles.guideInfo}>
                {item.guideType && (
                  <span className={styles.guideType}>{item.guideType}</span>
                )}
                {item.updatedAt && (
                  <span className={styles.guideDate}>
                    Updated <ReactTimeago date={item.updatedAt} />
                  </span>
                )}
              </div>
              <p className={styles.guideDesc}>{item.description}</p>
            </Link>
          ))}
        </div>
        <CardLink href="/guides" text="View All Guides" />
      </Card>
      <Card
        header={{ title: 'Top Community Gear Setups' }}
        className={styles.setupsPanel}
      >
        <div className={styles.communityList}>
          {setups.map((item, i) => (
            <Link key={i} href={item.href} className={styles.guideItem}>
              <span className={styles.guideTitle}>
                <i className="fas fa-shield-halved" />
                {item.title}
              </span>
              <div className={styles.guideInfo}>
                {item.author && (
                  <span className={styles.guideAuthor}>by {item.author}</span>
                )}
              </div>
              {item.score !== undefined && (
                <div className={styles.setupStats}>
                  <div className={styles.score}>
                    <i className="fas fa-star" />
                    <span>{item.score}</span>
                  </div>
                  <div className={styles.views}>
                    <i className="fas fa-eye" />
                    <span>{item.views}</span>
                  </div>
                </div>
              )}
            </Link>
          ))}
        </div>
        <CardLink href="/setups" text="View All Setups" />
      </Card>
    </div>
  );
}

export function HomeCards() {
  const [selectedChallenge, setSelectedChallenge] =
    useState<SupportedChallenge | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(
      LocalStorageKey.SELECTED_CHALLENGE,
    );
    if (stored !== null) {
      const parsed = parseInt(stored);
      if (SUPPORTED_CHALLENGES.includes(parsed as SupportedChallenge)) {
        setSelectedChallenge(parsed as SupportedChallenge);
        return;
      }
    }
    setSelectedChallenge(ChallengeType.TOB);
  }, []);

  const handleSelect = useCallback((type: SupportedChallenge) => {
    setSelectedChallenge(type);
    window.localStorage.setItem(
      LocalStorageKey.SELECTED_CHALLENGE,
      type.toString(),
    );
  }, []);

  if (selectedChallenge === null) {
    return (
      <div className={styles.statsGrid}>
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i} className={styles.skeletonCard}>
            <div className={styles.skeletonText} style={{ width: '100%' }}>
              <div className={styles.skeletonLine} style={{ width: '60%' }} />
              <div className={styles.skeletonLine} style={{ width: '80%' }} />
              <div className={styles.skeletonLine} style={{ width: '40%' }} />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.statsGrid}>
      <ChallengeSelector selected={selectedChallenge} onSelect={handleSelect} />
      <ChallengeStatsCard challengeType={selectedChallenge} />
      <LeaderboardCard challengeType={selectedChallenge} />
    </div>
  );
}
