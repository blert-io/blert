import { ChallengeMode, ChallengeStatus, ChallengeType } from '@blert/common';
import { redirect } from 'next/navigation';
import { ResolvingMetadata } from 'next';

import {
  aggregateChallenges,
  ChallengeOverview,
  findChallenges,
} from '@/actions/challenge';
import { getFollowing, getSuggestedPlayers, loadFeed } from '@/actions/feed';
import { getConnectedPlayers, getSignedInUser } from '@/actions/users';
import Card from '@/components/card';
import { basicMetadata } from '@/utils/metadata';
import { ticksToFormattedDuration } from '@/utils/tick';

import FeedPage from './feed-page';
import OnboardingCard from './onboarding-card';
import WelcomeStats from './welcome-stats';

import styles from './style.module.scss';

const INITIAL_FEED_SIZE = 20;

async function getLastChallenge(
  usernames: string[],
): Promise<ChallengeOverview | null> {
  if (usernames.length === 0) {
    return null;
  }

  const [challenges] = await findChallenges(1, {
    party: usernames,
    partyMatch: 'any',
    sort: '-startTime',
  });

  return challenges[0] ?? null;
}

type WeekActivity = {
  type: ChallengeType;
  mode: ChallengeMode;
  scale: number;
  count: number;
};

async function getThisWeekActivity(
  usernames: string[],
  limit: number = 3,
): Promise<WeekActivity[]> {
  if (usernames.length === 0) {
    return [];
  }

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const result = await aggregateChallenges(
    {
      party: usernames,
      partyMatch: 'any',
      startTime: ['>=', oneWeekAgo],
    },
    { '*': 'count' },
    {},
    ['type', 'mode', 'scale'] as const,
  );

  if (result === null) {
    return [];
  }

  // Flatten the nested grouped result into an array.
  const activities: WeekActivity[] = [];
  for (const [typeStr, byMode] of Object.entries(result)) {
    for (const [modeStr, byScale] of Object.entries(byMode)) {
      for (const [scaleStr, data] of Object.entries(byScale)) {
        activities.push({
          type: parseInt(typeStr) as ChallengeType,
          mode: parseInt(modeStr) as ChallengeMode,
          scale: parseInt(scaleStr),
          count: data['*'].count,
        });
      }
    }
  }

  activities.sort((a, b) => b.count - a.count);
  return activities.slice(0, limit);
}

type QuickStats = {
  recordings: number;
  completions: number;
  timeRecorded: string;
};

async function getQuickStats(usernames: string[]): Promise<QuickStats> {
  if (usernames.length === 0) {
    return { recordings: 0, completions: 0, timeRecorded: '0m' };
  }

  const [allStats, completedStats] = await Promise.all([
    aggregateChallenges(
      { party: usernames, partyMatch: 'any' },
      { '*': 'count', challengeTicks: 'sum' },
    ),
    aggregateChallenges(
      {
        party: usernames,
        partyMatch: 'any',
        status: ['==', ChallengeStatus.COMPLETED],
      },
      { '*': 'count' },
    ),
  ]);

  const recordings = allStats?.['*']?.count ?? 0;
  const completions = completedStats?.['*']?.count ?? 0;
  const totalTicks = allStats?.challengeTicks?.sum ?? 0;
  const timeRecorded = ticksToFormattedDuration(totalTicks);

  return { recordings, completions, timeRecorded };
}

export default async function Dashboard() {
  const user = await getSignedInUser();
  if (user === null) {
    redirect('/login');
  }

  const connectedPlayers = await getConnectedPlayers();
  const connectedUsernames = connectedPlayers.map((p) => p.username);

  const [
    feedResult,
    followingResult,
    suggestions,
    quickStats,
    lastChallenge,
    thisWeek,
  ] = await Promise.all([
    loadFeed({ limit: INITIAL_FEED_SIZE }),
    getFollowing(),
    getSuggestedPlayers({ limit: 20 }),
    getQuickStats(connectedUsernames),
    getLastChallenge(connectedUsernames),
    getThisWeekActivity(connectedUsernames),
  ]);
  const {
    items: initialFeed,
    olderCursor: initialOlderCursor,
    newerCursor: initialNewerCursor,
  } = feedResult;
  const { players: following, totalCount: followingCount } = followingResult;

  const hasConnectedPlayers = connectedPlayers.length > 0;
  const displayName = user.displayUsername ?? user.username;

  return (
    <div className={styles.dashboard}>
      <Card className={styles.welcomeSection}>
        {hasConnectedPlayers ? (
          <WelcomeStats
            username={displayName}
            stats={quickStats}
            lastChallenge={lastChallenge}
            thisWeek={thisWeek}
          />
        ) : (
          <OnboardingCard username={displayName} />
        )}
      </Card>

      <FeedPage
        userId={user.id}
        initialFeed={initialFeed}
        initialOlderCursor={initialOlderCursor}
        initialNewerCursor={initialNewerCursor}
        following={following}
        followingCount={followingCount}
        suggestions={suggestions}
      />
    </div>
  );
}

export async function generateMetadata(
  _props: Record<string, never>,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'Dashboard',
    description: 'Your personal Blert activity dashboard.',
  });
}

export const dynamic = 'force-dynamic';
