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
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactTimeago from 'react-timeago';

import { ActivityFeedItem, ChallengeEndFeedItem } from './actions/activity';
import { RankedSplit } from './actions/challenge';
import { SetupListItem } from './actions/setup';
import ActivityChart from './components/activity-chart';
import Card, { CardLink } from './components/card';
import Carousel from './components/carousel';
import RadioInput from './components/radio-input';
import { useClientOnly } from './hooks/client-only';
import { partyNames } from './utils/challenge-description';
import { ticksToFormattedSeconds } from './utils/tick';
import { challengeUrl, queryString } from './utils/url';

import styles from './home.module.scss';

const DEFAULT_REFRESH_INTERVAL = 15 * 1000;

const enum LocalStorageKey {
  STATS_TIME_PERIOD = 'home-stats-time-period',
  LEADERBOARD_TIME_PERIOD = 'home-leaderboard-time-period',
  ACTIVITY_FILTER = 'home-activity-filter',
}

type ActivityFeedProps = {
  limit?: number;
  initialFeed?: ActivityFeedItem[];
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

type PlayerActivity = {
  startHour: number;
  data: Array<{
    hour: number;
    count: number;
  }>;
};

function ActivityChartWrapper() {
  const [activityData, setActivityData] = useState<PlayerActivity>({
    startHour: new Date().getUTCHours(),
    data: [],
  });

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/activity/players`);
      const payload: number[] = await res.json();
      setActivityData({
        startHour: new Date().getUTCHours(),
        data: payload.map((p, i) => ({ hour: i, count: p })),
      });
    } catch (err) {
      // TODO(frolv): Handle error.
    }
  }, [setActivityData]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, DEFAULT_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <ActivityChart
      data={activityData.data}
      icon="fas fa-users"
      title="Active Players"
      timeRange="Last 24h"
      height={100}
      startHour={activityData.startHour}
    />
  );
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

type Stats = {
  total: number;
  completions: number;
  mostPopularScale: {
    scale: number;
    percentage: number;
  };
};

type ChallengeStatsProps = {
  initialStats?: Stats;
};

type GroupedCount = Record<number, { '*': { count: number } }>;

export function ChallengeStats({ initialStats }: ChallengeStatsProps) {
  const [stats, setStats] = useState<Stats>(
    initialStats ?? {
      total: 0,
      completions: 0,
      mostPopularScale: {
        scale: 0,
        percentage: 0,
      },
    },
  );
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(TimePeriod.DAY);

  useEffect(() => {
    const storedTimePeriod = window.localStorage.getItem(
      LocalStorageKey.STATS_TIME_PERIOD,
    );
    if (storedTimePeriod !== null) {
      setTimePeriod(parseInt(storedTimePeriod) as TimePeriod);
    }
  }, []);

  const changeTimePeriod = useCallback(
    (period: TimePeriod) => {
      setTimePeriod(period);
      window.localStorage.setItem(
        LocalStorageKey.STATS_TIME_PERIOD,
        period.toString(),
      );
    },
    [setTimePeriod],
  );

  const fetchStats = useCallback(async () => {
    const challengeType = ChallengeType.TOB;
    const start = startOfTimePeriod(timePeriod);

    const filterParams = queryString({
      type: challengeType,
      startTime: `ge${start.getTime()}`,
    });

    try {
      const [scalePayload, statusPayload]: [GroupedCount, GroupedCount] =
        await Promise.all([
          fetch(`/api/v1/challenges/stats?${filterParams}&group=scale`).then(
            (res) => res.json(),
          ),
          fetch(`/api/v1/challenges/stats?${filterParams}&group=status`).then(
            (res) => res.json(),
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

      const stats: Stats = {
        total: totalChallenges,
        completions: statusPayload[ChallengeStatus.COMPLETED]?.['*'].count ?? 0,
        mostPopularScale: {
          scale: mostPopularScale,
          percentage:
            totalChallenges > 0
              ? (mostPopularScaleCount / totalChallenges) * 100
              : 0,
        },
      };
      setStats(stats);
    } catch (err) {
      // TODO(frolv): Handle error.
    }
  }, [setStats, timePeriod]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, DEFAULT_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return (
    <Card
      primary
      header={{
        title: 'Theatre of Blood',
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
          <span className={styles.label}>Raids</span>
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
          <span className={styles.label}>Completion Rate</span>
        </div>
      </div>
      <div className={styles.quickStats}>
        <div className={styles.quickStat}>
          <i className="fas fa-person-running" />
          <span>
            {stats.mostPopularScale.scale === 0
              ? 'No raids completed'
              : `Top Scale: ${scaleName(stats.mostPopularScale.scale)} ` +
                `(${stats.mostPopularScale.percentage.toFixed(1)}% of raids)`}
          </span>
        </div>
      </div>
      <ActivityChartWrapper />
      <CardLink href="/raids/tob" text="Browse Raids" />
    </Card>
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

  switch (item.type) {
    case ActivityFeedItemType.CHALLENGE_END: {
      const challenge = (item as ChallengeEndFeedItem).challenge;
      let name: string = challengeName(challenge.type);
      let status: string = '';

      if (challenge.type === ChallengeType.TOB) {
        if (challenge.mode === ChallengeMode.TOB_HARD) {
          name += ' (HM)';
        } else if (challenge.mode === ChallengeMode.TOB_ENTRY) {
          name += ' (Entry)';
        }
      }

      switch (challenge.status) {
        case ChallengeStatus.COMPLETED:
          icon = '🏃';
          status = 'completed';
          break;
        case ChallengeStatus.RESET:
          icon = '🔄';
          status = `reset at ${stageName(challenge.stage)}`;
          break;
        case ChallengeStatus.WIPED:
          icon = '💀';
          status = `wiped at ${stageName(challenge.stage)}`;
          break;
      }

      content = (
        <span>
          <strong>{partyNames(challenge as Challenge)}</strong>{' '}
          <Link href={challengeUrl(challenge.type, challenge.uuid)}>
            {status}
          </Link>
          {challenge.status === ChallengeStatus.COMPLETED ? ' a ' : ' in a '}
          {scaleName(challenge.scale).toLowerCase()} {name}
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
    // TODO(frolv): Implement PB feed.
    // case ActivityFeedItemType.PB: {
    //   icon = '🏆';
    //   content = (
    //     <span>
    //       <strong>Username</strong> achieved a new PB of{' '}
    //       <strong>14:23</strong>
    //     </span>
    //   );
    //   break;
    // }
  }

  return (
    <div
      className={`${styles.feedItem} ${mounted ? styles.newItem : ''}`}
      style={
        {
          '--item-index': index,
        } as React.CSSProperties
      }
    >
      <div className={styles.feedIcon}>{icon}</div>
      <div className={styles.feedContent}>{content}</div>
      <span className={styles.feedTime}>
        <ReactTimeago
          date={item.time}
          formatter={(value, unit) => `${value}${unit[0]} ago`}
        />
      </span>
    </div>
  );
}

function feedKeys(feed: ActivityFeedItem[]) {
  return feed.map((item) => item.time.getTime().toString()).join(',');
}

const enum FeedType {
  ALL,
  CHALLENGES,
  PBS,
}

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
  const [feedType, setFeedType] = useState<FeedType>(FeedType.ALL);

  useEffect(() => {
    const storedFeedType = window.localStorage.getItem(
      LocalStorageKey.ACTIVITY_FILTER,
    );
    if (storedFeedType !== null) {
      setFeedType(parseInt(storedFeedType) as FeedType);
    }
  }, []);

  const changeFeedType = useCallback(
    (type: FeedType) => {
      setFeedType(type);
      window.localStorage.setItem(
        LocalStorageKey.ACTIVITY_FILTER,
        type.toString(),
      );
    },
    [setFeedType],
  );

  const fetchActivity = useCallback(async () => {
    try {
      setError(false);
      const res = await fetch(`/api/activity/feed?limit=${limit}`);
      if (!res.ok) {
        throw new Error(`Fetch failed with status ${res.status}`);
      }
      const data: ActivityFeedItem[] = await res.json().then((data: any) =>
        data.map((item: any) => ({
          ...item,
          time: new Date(item.time),
        })),
      );

      // Only update feed if there are new items to avoid unnecessary animations.
      if (feedKeys(data) !== feedItemKeys.current) {
        setFeed(data);
        feedItemKeys.current = feedKeys(data);
      }

      setInitialLoading(false);
    } catch (err) {
      setError(true);
      setInitialLoading(true);
    }
  }, [limit]);

  useEffect(() => {
    fetchActivity();
    const interval = setInterval(fetchActivity, DEFAULT_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchActivity]);

  return (
    <Card header={{ title: 'Live Activity' }} className={styles.activityFeed}>
      {/* TODO(frolv): Enable filtering once PB feed is implemented.
        <RadioInput.Group
          name="feed-type"
          className={styles.filters}
          onChange={(value) => changeFeedType(value as FeedType)}
          compact
          joined
        >
          <RadioInput.Option
            value={FeedType.ALL}
            id="feed-type-all"
            label="All"
            checked={feedType === FeedType.ALL}
          />
          <RadioInput.Option
            value={FeedType.CHALLENGES}
            id="feed-type-challenges"
            label="Challenges"
            checked={feedType === FeedType.CHALLENGES}
          />
          <RadioInput.Option
            value={FeedType.PBS}
            id="feed-type-pbs"
            label="PBs"
            checked={feedType === FeedType.PBS}
          />
        </RadioInput.Group> */}
      <div className={styles.feedItems}>
        {error ? (
          <ErrorState onRetry={fetchActivity} />
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

const CAROUSEL_WIDTH = 320;

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
      const res = await fetch('/api/setups?limit=2');
      const data: SetupListItem[] = await res.json();
      setSetups(
        data.map((setup) => ({
          title: setup.name,
          description: '',
          href: `/setups/${setup.publicId}`,
          updatedAt: setup.updatedAt ? new Date(setup.updatedAt) : undefined,
          score: setup.score,
          views: setup.views,
          author: setup.author,
        })),
      );
    } catch (err) {
      // TODO(frolv): Handle error.
    }
  }, []);

  useEffect(() => {
    fetchSetups();
    const interval = setInterval(fetchSetups, DEFAULT_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchSetups]);

  const renderGuideList = (
    items: GuideCardItem[],
    viewAllLink: { href: string; text: string },
  ) => (
    <div className={styles.guideList} style={{ width: CAROUSEL_WIDTH }}>
      {items.map((item, i) => (
        <Link key={i} href={item.href} className={styles.guideItem}>
          <span className={styles.guideTitle}>{item.title}</span>
          <div className={styles.guideInfo}>
            {item.guideType && (
              <span className={styles.guideType}>{item.guideType}</span>
            )}
            {item.author && (
              <span className={styles.guideAuthor}>by {item.author}</span>
            )}
            {item.updatedAt && (
              <span className={styles.guideDate}>
                Updated <ReactTimeago date={item.updatedAt} />
              </span>
            )}
          </div>
          <p className={styles.guideDesc}>{item.description}</p>
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
      <CardLink href={viewAllLink.href} text={viewAllLink.text} />
    </div>
  );

  return (
    <Card header={{ title: 'Community Contributions' }}>
      <div className={styles.carousel}>
        <Carousel
          itemWidth={CAROUSEL_WIDTH}
          autoCycle
          cycleDuration={8000}
          showArrows={false}
        >
          <div className={styles.carouselItem}>
            <h3 className={styles.carouselTitle}>Latest Guides</h3>
            {renderGuideList(SHOWCASE_GUIDES, {
              href: '/guides',
              text: 'View All Guides',
            })}
          </div>
          <div className={styles.carouselItem}>
            <h3 className={styles.carouselTitle}>Highest Rated Gear Setups</h3>
            {renderGuideList(setups, {
              href: '/setups',
              text: 'View All Setups',
            })}
          </div>
        </Carousel>
      </div>
    </Card>
  );
}

type LeaderboardEntry = {
  rank: number;
  time: number;
  party: string[];
  uuid: string;
  date: Date;
};

type ScaleLeaderboard = {
  scale: number;
  entries: LeaderboardEntry[];
};

function Leaderboard({ leaderboard }: { leaderboard: ScaleLeaderboard }) {
  const isClient = useClientOnly();

  return (
    <div className={styles.leaderboardList} style={{ width: CAROUSEL_WIDTH }}>
      <h3 className={styles.carouselTitle}>
        {scaleName(leaderboard.scale)} Theatre of Blood
      </h3>
      <div className={styles.leaderboardEntries}>
        {leaderboard.entries.length > 0 ? (
          leaderboard.entries.map((entry) => (
            <Link
              key={entry.uuid}
              href={challengeUrl(ChallengeType.TOB, entry.uuid)}
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
                <div className={styles.time}>
                  {ticksToFormattedSeconds(entry.time)}
                </div>
              </div>
              <div className={styles.partyInfo}>
                <div className={styles.party}>{entry.party.join(', ')}</div>
              </div>
            </Link>
          ))
        ) : (
          <div className={styles.emptyState}>
            <i className="fas fa-trophy" />
            <p>
              No regular {scaleName(leaderboard.scale)} raids have been
              completed in this time period.
            </p>
            <p>Record your next raid to be first on the leaderboard!</p>
          </div>
        )}
        <CardLink
          href={`/leaderboards/tob/regular/${leaderboard.scale}`}
          text="View Full Leaderboards"
        />
      </div>
    </div>
  );
}

export function LeaderboardCard({
  initialLeaderboards = [],
}: {
  initialLeaderboards?: ScaleLeaderboard[];
}) {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(TimePeriod.DAY);
  const [leaderboards, setLeaderboards] =
    useState<ScaleLeaderboard[]>(initialLeaderboards);

  useEffect(() => {
    const storedTimePeriod = window.localStorage.getItem(
      LocalStorageKey.LEADERBOARD_TIME_PERIOD,
    );
    if (storedTimePeriod !== null) {
      setTimePeriod(parseInt(storedTimePeriod) as TimePeriod);
    }
  }, []);

  const changeTimePeriod = useCallback(
    (period: TimePeriod) => {
      setTimePeriod(period);
      window.localStorage.setItem(
        LocalStorageKey.LEADERBOARD_TIME_PERIOD,
        period.toString(),
      );
    },
    [setTimePeriod],
  );

  const fetchLeaderboards = useCallback(async () => {
    const params = {
      splits: [SplitType.TOB_REG_CHALLENGE],
      limit: 3,
      from: startOfTimePeriod(timePeriod).getTime(),
    };

    try {
      const responses = await Promise.all(
        [5, 4, 3, 2].map((scale) =>
          fetch(
            `/api/v1/leaderboards?${queryString({ ...params, scale })}`,
          ).then((res) => res.json()),
        ),
      );

      const leaderboards = responses.map((res, i) => ({
        scale: 5 - i,
        entries: (res[SplitType.TOB_REG_CHALLENGE] ?? []).map(
          (entry: RankedSplit, i: number) => ({
            rank: i + 1,
            time: entry.ticks,
            party: entry.party,
            uuid: entry.uuid,
            date: entry.date,
          }),
        ),
      }));

      setLeaderboards(leaderboards);
    } catch (err) {
      // TODO(frolv): Handle error.
    }
  }, [timePeriod, setLeaderboards]);

  useEffect(() => {
    fetchLeaderboards();
    const interval = setInterval(
      fetchLeaderboards,
      // Leaderboard don't change that often, so update them less frequently.
      DEFAULT_REFRESH_INTERVAL * 5,
    );
    return () => clearInterval(interval);
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
        {leaderboards.length > 0 ? (
          <Carousel
            itemWidth={CAROUSEL_WIDTH}
            autoCycle
            cycleDuration={11300}
            showArrows={false}
          >
            {leaderboards.map((leaderboard) => (
              <div key={leaderboard.scale} className={styles.carouselItem}>
                <Leaderboard leaderboard={leaderboard} />
              </div>
            ))}
          </Carousel>
        ) : (
          <div className={styles.emptyState}>
            <i className="fas fa-trophy" />
            <p>No leaderboards found for this period</p>
          </div>
        )}
      </div>
    </Card>
  );
}
