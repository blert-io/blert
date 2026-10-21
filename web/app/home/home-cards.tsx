'use client';

import {
  ActivityFeedItemType,
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
import ChallengeSelector from '@/components/challenge-selector';
import RadioInput from '@/components/radio-input';
import { challengeLogo } from '@/logo';
import { useClientOnly } from '@/hooks/client-only';
import { challengeSlug, challengeTerm } from '@/utils/challenge';
import { challengePartyNames } from '@/utils/challenge-description';
import { withIndefiniteArticle } from '@/utils/copy';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl, queryString } from '@/utils/url';

import styles from './style.module.scss';

const DEFAULT_REFRESH_INTERVAL = 30 * 1000;

const enum LocalStorageKey {
  SELECTED_CHALLENGE = 'home-selected-challenge',
  TIME_PERIOD = 'home-time-period',
}

const SUPPORTED_CHALLENGES = [
  ChallengeType.TOB,
  ChallengeType.TFA,
  ChallengeType.COLOSSEUM,
  ChallengeType.INFERNO,
  ChallengeType.MOKHAIOTL,
] as const;

type SupportedChallenge = (typeof SUPPORTED_CHALLENGES)[number];

type ChallengeInfo = {
  name: string;
  description: string;
  hubUrl: string;
  browseText: string;
  leaderboardSplit: SplitType;
  leaderboardScales: number[];
  leaderboardUrl: string;
  image?: string;
};

const CHALLENGE_INFO: Record<SupportedChallenge, ChallengeInfo> = {
  [ChallengeType.TOB]: {
    name: 'Theatre of Blood',
    description:
      'Replay every crab spawn, Nylo wave, maze, and everything in between ' +
      'from Maiden to Verzik.',
    hubUrl: '/raids/tob',
    browseText: 'Browse Raids',
    leaderboardSplit: SplitType.TOB_REG_CHALLENGE,
    leaderboardScales: [5, 4, 3, 2],
    leaderboardUrl: '/leaderboards/tob',
  },
  [ChallengeType.TFA]: {
    name: 'The Fractured Archive',
    description:
      'Follow your team as you progress through the Archive to face Ocellus.',
    hubUrl: '/raids/tfa',
    browseText: 'Browse Raids',
    leaderboardSplit: SplitType.TFA_CHALLENGE,
    leaderboardScales: [8, 7, 6, 5, 4, 3],
    leaderboardUrl: '/leaderboards/tfa',
  },
  [ChallengeType.COLOSSEUM]: {
    name: 'Colosseum',
    description:
      'Track modifier choices, solve pillar stacks, and analyze each wave as ' +
      'you fight your way to Sol Heredit.',
    hubUrl: '/challenges/colosseum',
    browseText: 'Browse Runs',
    leaderboardSplit: SplitType.COLOSSEUM_CHALLENGE,
    leaderboardScales: [1],
    leaderboardUrl: '/leaderboards/colosseum',
  },
  [ChallengeType.INFERNO]: {
    name: 'Inferno',
    description:
      'Break down wave spawns, positioning, and prayer flicks from the ' +
      'moment you enter the Inferno to Zuk.',
    hubUrl: '/challenges/inferno',
    browseText: 'Browse Runs',
    leaderboardSplit: SplitType.INFERNO_CHALLENGE,
    leaderboardScales: [1],
    leaderboardUrl: '/leaderboards/inferno',
  },
  [ChallengeType.MOKHAIOTL]: {
    name: 'Doom of Mokhaiotl',
    description:
      'Follow each delve as you descend into the ruins, tracking every orb, ' +
      'larva, and acid splat as the room shrinks around you.',
    hubUrl: '/challenges/mokhaiotl',
    browseText: 'Browse Runs',
    leaderboardSplit: SplitType.MOKHAIOTL_CHALLENGE,
    leaderboardScales: [1],
    leaderboardUrl: '/leaderboards/mokhaiotl',
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
}

const TIME_PERIODS = [TimePeriod.DAY, TimePeriod.WEEK, TimePeriod.MONTH];

const TIME_PERIOD_INFO: Record<TimePeriod, { label: string; heading: string }> =
  {
    [TimePeriod.DAY]: { label: 'Day', heading: 'Today' },
    [TimePeriod.WEEK]: { label: 'Week', heading: 'Past week' },
    [TimePeriod.MONTH]: { label: 'Month', heading: 'Past month' },
  };

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
  }
  return start;
}

type ChallengeOverviewProps = {
  challengeType: SupportedChallenge;
};

function ChallengeOverview({ challengeType }: ChallengeOverviewProps) {
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [uniquePlayers, setUniquePlayers] = useState<number | null>(null);
  const info = CHALLENGE_INFO[challengeType];

  useEffect(() => {
    setTotalCount(null);
    setUniquePlayers(null);

    const controller = new AbortController();
    const params = queryString({ type: challengeType });

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
  }, [challengeType]);

  const term = challengeTerm(challengeType, true).toLowerCase();

  return (
    <div className={styles.exploreColumn}>
      <div className={styles.overviewBody}>
        <div className={styles.overviewImage}>
          <Image
            src={info.image ?? challengeLogo(challengeType)}
            alt={info.name}
            width={62}
            height={62}
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={styles.overviewText}>
          <h3 className={styles.overviewName}>{info.name}</h3>
          <p className={styles.overviewDescription}>{info.description}</p>
        </div>
      </div>
      <div className={styles.overviewStats}>
        {totalCount !== null && (
          <div className={styles.overviewStat}>
            <span className={styles.overviewStatValue}>
              {totalCount.toLocaleString()}
            </span>
            <span className={styles.overviewStatLabel}>{term} recorded</span>
          </div>
        )}
        {uniquePlayers !== null && (
          <div className={styles.overviewStat}>
            <span className={`${styles.overviewStatValue} ${styles.muted}`}>
              {uniquePlayers.toLocaleString()}
            </span>
            <span className={styles.overviewStatLabel}>players tracked</span>
          </div>
        )}
      </div>
      <Link href={info.hubUrl} className={styles.overviewCta}>
        {info.browseText} <i className="fas fa-arrow-right" />
      </Link>
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
  timePeriod: TimePeriod;
};

function ChallengeStats({ challengeType, timePeriod }: ChallengeStatsProps) {
  const term = challengeTerm(challengeType, true);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    completions: 0,
    mostPopularScale: { scale: 0, percentage: 0 },
    avgCompletionTicks: null,
  });

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
    <div className={styles.exploreColumn}>
      <h3 className={styles.subheading}>
        {TIME_PERIOD_INFO[timePeriod].heading}
      </h3>
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
    </div>
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
    <div className={styles.leaderboardList}>
      <h3 className={styles.subheading}>
        Top times
        {hasMultipleScales && ` · ${scaleName(leaderboard.scale)}`}
      </h3>
      <div className={styles.leaderboardEntries}>
        {leaderboard.entries.length > 0 ? (
          leaderboard.entries.map((entry) => (
            <Link
              key={entry.uuid}
              href={challengeUrl(challengeType, entry.uuid)}
              className={styles.leaderboardEntry}
            >
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
                <div className={styles.date}>
                  {isClient && <ReactTimeago date={entry.date} />}
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

type TopTimesProps = {
  challengeType: SupportedChallenge;
  timePeriod: TimePeriod;
};

function TopTimes({ challengeType, timePeriod }: TopTimesProps) {
  const [leaderboards, setLeaderboards] = useState<ScaleLeaderboard[]>([]);
  const info = CHALLENGE_INFO[challengeType];
  const hasMultipleScales = info.leaderboardScales.length > 1;

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
    <div className={styles.exploreColumn}>
      {hasMultipleScales ? (
        leaderboards.length > 0 ? (
          <Carousel
            autoCycle
            cycleDuration={11300}
            showArrows={false}
            loop
            label="Leaderboards by scale"
          >
            {leaderboards.map((leaderboard) => (
              <Leaderboard
                key={`${timePeriod}-${leaderboard.scale}`}
                leaderboard={leaderboard}
                challengeType={challengeType}
              />
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

      if (challenge.scale > 1) {
        name = `${scaleName(challenge.scale).toLowerCase()} ${name}`;
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
          <strong>{challengePartyNames(challenge)}</strong> {status}
          {challenge.status === ChallengeStatus.COMPLETED ? ' ' : ' in '}
          {withIndefiniteArticle(name)}
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
          formatter={(value: number, unit: Unit) =>
            `${value}${unit === 'month' ? 'mo' : unit[0]} ago`
          }
        />
      </span>
    </Link>
  );
}

function feedItemKey(item: ActivityFeedItem): string {
  switch (item.type) {
    case ActivityFeedItemType.CHALLENGE_END:
      return (item as ChallengeEndFeedItem).challenge.uuid;
  }
}

function feedKeys(feed: ActivityFeedItem[]) {
  return feed.map(feedItemKey).join(',');
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
            <FeedItem key={feedItemKey(item)} item={item} index={i} />
          ))
        )}
      </div>
    </Card>
  );
}

type ShowcaseGuide = {
  title: string;
  description: string;
  href: string;
  updatedAt: Date;
  guideType: string;
};

const SHOWCASE_GUIDES: ShowcaseGuide[] = [
  {
    title: 'Humid Bloat',
    description:
      "How to use Humidify to attack Bloat while he's up without dying",
    href: '/guides/tob/bloat/humid',
    guideType: 'Theatre of Blood',
    updatedAt: new Date('2026-09-20'),
  },
  {
    title: 'Trio Nylocas Waves',
    description: 'Complete strategy for 3-player teams',
    href: '/guides/tob/nylocas/trio',
    guideType: 'Theatre of Blood',
    updatedAt: new Date('2026-06-17'),
  },
];

export function CommunityCard() {
  const [setups, setSetups] = useState<SetupListItem[]>([]);

  const fetchSetups = useCallback(async () => {
    try {
      const res = await fetch('/api/setups?limit=2&sort=score&state=published');
      const data = (await res.json()) as { setups: SetupListItem[] };
      setSetups(data.setups);
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
    <Card header={{ title: 'Learn from the community' }}>
      <div className={styles.communitySections}>
        <section className={`${styles.communitySection} ${styles.guides}`}>
          <h3 className={styles.subheading}>
            <i className="fas fa-book" />
            Guides
          </h3>
          {SHOWCASE_GUIDES.map((guide) => (
            <Link
              key={guide.href}
              href={guide.href}
              className={styles.communityItem}
            >
              <span className={styles.communityTitle}>{guide.title}</span>
              <span className={styles.guideDescription}>
                {guide.description}
              </span>
              <span className={styles.communityMeta}>
                {guide.guideType} · Updated{' '}
                <ReactTimeago date={guide.updatedAt} />
              </span>
            </Link>
          ))}
          <CardLink href="/guides" text="View All Guides" />
        </section>
        <section className={`${styles.communitySection} ${styles.setups}`}>
          <h3 className={styles.subheading}>
            <i className="fas fa-shield-halved" />
            Top community gear setups
          </h3>
          {setups.map((setup) => (
            <Link
              key={setup.publicId}
              href={`/setups/${setup.publicId}`}
              className={`${styles.communityItem} ${styles.setupItem}`}
            >
              <span className={styles.setupInfo}>
                <span className={styles.communityTitle}>{setup.name}</span>
                <span className={styles.communityMeta}>by {setup.author}</span>
              </span>
              <span className={styles.setupStats}>
                <span className={styles.setupScore}>
                  <i className="fas fa-star" />
                  {setup.score}
                </span>
                <span>
                  <i className="fas fa-eye" />
                  {setup.views.toLocaleString()}
                </span>
              </span>
            </Link>
          ))}
          <CardLink href="/setups" text="View All Setups" />
        </section>
      </div>
    </Card>
  );
}

export function HomeCards() {
  const [selectedChallenge, setSelectedChallenge] =
    useState<SupportedChallenge | null>(null);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(TimePeriod.DAY);

  useEffect(() => {
    const storedPeriod = window.localStorage.getItem(
      LocalStorageKey.TIME_PERIOD,
    );
    if (storedPeriod !== null) {
      const parsed = parseInt(storedPeriod);
      if (TIME_PERIODS.includes(parsed)) {
        setTimePeriod(parsed);
      }
    }

    const stored = window.localStorage.getItem(
      LocalStorageKey.SELECTED_CHALLENGE,
    );
    if (stored !== null) {
      const parsed = parseInt(stored);
      if (SUPPORTED_CHALLENGES.includes(parsed)) {
        setSelectedChallenge(parsed);
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

  const changeTimePeriod = useCallback((period: TimePeriod) => {
    setTimePeriod(period);
    window.localStorage.setItem(LocalStorageKey.TIME_PERIOD, period.toString());
  }, []);

  return (
    <Card
      header={{
        title: 'Explore',
        action: (
          <RadioInput.Group
            name="time-selector"
            className={styles.filters}
            onChange={(value) => changeTimePeriod(value as TimePeriod)}
            compact
            joined
          >
            {TIME_PERIODS.map((period) => (
              <RadioInput.Option
                key={period}
                value={period}
                id={`time-selector-${TIME_PERIOD_INFO[period].label.toLowerCase()}`}
                label={TIME_PERIOD_INFO[period].label}
                checked={timePeriod === period}
              />
            ))}
          </RadioInput.Group>
        ),
      }}
    >
      <div className={styles.challengePicker}>
        {selectedChallenge !== null && (
          <ChallengeSelector
            challenges={SUPPORTED_CHALLENGES}
            id="home-challenge"
            onChange={handleSelect}
            value={selectedChallenge}
          />
        )}
      </div>
      {selectedChallenge === null ? (
        <div className={styles.exploreColumns}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={styles.skeletonColumn}>
              <div className={styles.skeletonLine} style={{ width: '60%' }} />
              <div className={styles.skeletonLine} style={{ width: '80%' }} />
              <div className={styles.skeletonLine} style={{ width: '40%' }} />
            </div>
          ))}
        </div>
      ) : (
        <div
          className={styles.exploreColumns}
          data-challenge={challengeSlug(selectedChallenge)}
        >
          <ChallengeOverview challengeType={selectedChallenge} />
          <ChallengeStats
            challengeType={selectedChallenge}
            timePeriod={timePeriod}
          />
          <TopTimes
            key={selectedChallenge}
            challengeType={selectedChallenge}
            timePeriod={timePeriod}
          />
        </div>
      )}
    </Card>
  );
}
