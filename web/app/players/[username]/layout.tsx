'use server';

import { challengeName, ChallengeType, PrimaryMeleeGear } from '@blert/common';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { ResolvingMetadata } from 'next';

import {
  aggregateChallenges,
  findChallenges,
  loadPbsForPlayer,
  loadPlayerWithStats,
  type PlayerWithStats,
} from '@/actions/challenge';
import { isFollowing } from '@/actions/feed';
import { getSession } from '@/auth';
import { challengeTerm } from '@/utils/challenge';
import { oxford } from '@/utils/copy';

import FollowButton from './follow-button';
import RecentChallengeCard, { RecentChallenge } from './recent-challenge-card';
import { PlayerProvider } from './player-context';
import Navigation from './navigation';

import styles from './style.module.scss';

export type PlayerLayoutParams = Promise<{ username: string }>;

type PlayerLayoutProps = {
  children: React.ReactNode;
  params: PlayerLayoutParams;
};

type ChallengeCounts = {
  type: ChallengeType;
  completions: number;
  total: number;
};

function challengeCountsByType(
  stats: PlayerWithStats['stats'],
): ChallengeCounts[] {
  const counts = (
    type: ChallengeType,
    completions: number,
    wipes: number,
    resets: number,
  ): ChallengeCounts => ({
    type,
    completions,
    total: completions + wipes + resets,
  });

  return [
    counts(
      ChallengeType.TOB,
      stats.tobCompletions,
      stats.tobWipes,
      stats.tobResets,
    ),
    counts(
      ChallengeType.COLOSSEUM,
      stats.colosseumCompletions,
      stats.colosseumWipes,
      stats.colosseumResets,
    ),
    counts(
      ChallengeType.INFERNO,
      stats.infernoCompletions,
      stats.infernoWipes,
      stats.infernoResets,
    ),
    counts(
      ChallengeType.MOKHAIOTL,
      stats.mokhaiotlCompletions,
      stats.mokhaiotlWipes,
      stats.mokhaiotlResets,
    ),
    counts(
      ChallengeType.TFA,
      stats.tfaCompletions,
      stats.tfaWipes,
      stats.tfaResets,
    ),
  ]
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
}

function PlayerInfo({
  player,
  username,
  totalRecordedTicks,
  followButton,
  recentChallenge,
}: {
  player: PlayerWithStats;
  username: string;
  totalRecordedTicks: number;
  followButton: React.ReactNode;
  recentChallenge: RecentChallenge | null;
}) {
  const totalHoursPlayed = (totalRecordedTicks / 6000).toFixed(1);

  const counts = challengeCountsByType(player.stats);
  const completions = counts.reduce((sum, c) => sum + c.completions, 0);
  const total = counts.reduce((sum, c) => sum + c.total, 0);
  const completionRate =
    total > 0 ? ((completions / total) * 100).toFixed(1) : '0.0';

  return (
    <div className={styles.playerInfo}>
      <div className={styles.playerImgWrapper}>
        <Image
          src={`/images/gear/${PrimaryMeleeGear[PrimaryMeleeGear.BLORVA].toLowerCase()}.webp`}
          alt={PrimaryMeleeGear[PrimaryMeleeGear.BLORVA].toLowerCase()}
          fill
          style={{ objectFit: 'contain' }}
        />
      </div>
      <div className={styles.playerInfoText}>
        <div className={styles.nameRow}>
          <h1>{player.username}</h1>
          {followButton}
        </div>
        <div className={styles.playerStats}>
          <div className={styles.statRow}>
            <span className={styles.label}>
              <i className="fa-solid fa-clock" /> First recorded
            </span>
            <span className={styles.value}>
              {player.firstRecorded?.toLocaleDateString() ?? 'Never'}
            </span>
          </div>
          <div className={styles.statRow}>
            <span className={styles.label}>
              <i className="fa-solid fa-chart-simple" /> Completion rate
            </span>
            <span className={styles.value}>
              {completionRate}% ({completions}/{total})
            </span>
          </div>
          <div className={styles.statRow}>
            <span className={styles.label}>
              <i className="fa-solid fa-hourglass" /> Time played
            </span>
            <span className={styles.value}>{totalHoursPlayed} hours</span>
          </div>
        </div>
        <RecentChallengeCard
          key={username}
          username={username}
          initial={recentChallenge}
        />
      </div>
    </div>
  );
}

export default async function PlayerLayout({
  children,
  params,
}: PlayerLayoutProps) {
  const username = await params.then((u) => decodeURIComponent(u.username));
  const [player, totalRecordedTicks, personalBests, session, [challenges]] =
    await Promise.all([
      loadPlayerWithStats(username),
      aggregateChallenges(
        {
          party: [username],
        },
        { challengeTicks: { type: 'sum' } },
      ),
      loadPbsForPlayer(username),
      getSession(),
      findChallenges(1, { party: [username] }),
    ]);

  if (player === null) {
    return notFound();
  }

  const latestChallenge = challenges[0] ?? null;
  const initialRecentChallenge: RecentChallenge | null =
    latestChallenge !== null
      ? {
          uuid: latestChallenge.uuid,
          type: latestChallenge.type,
          status: latestChallenge.status,
          stage: latestChallenge.stage,
          mode: latestChallenge.mode,
          scale: latestChallenge.scale,
          startTime: latestChallenge.startTime.toISOString(),
        }
      : null;

  const isSignedIn = session !== null;
  const connectedPlayers = session?.connectedPlayers ?? [];
  const isOwnPlayer = connectedPlayers.some(
    (p) => p.username.toLowerCase() === player.username.toLowerCase(),
  );

  const following =
    isSignedIn && !isOwnPlayer ? await isFollowing(player.id) : false;

  const followButton = isOwnPlayer ? null : (
    <FollowButton
      playerId={player.id}
      username={player.username}
      isFollowing={following}
      isSignedIn={isSignedIn}
    />
  );

  return (
    <PlayerProvider player={{ ...player, personalBests }}>
      <div className={styles.playerPage}>
        <div className={styles.header}>
          <PlayerInfo
            player={player}
            username={username}
            totalRecordedTicks={totalRecordedTicks?.challengeTicks.sum ?? 0}
            followButton={followButton}
            recentChallenge={initialRecentChallenge}
          />
          <Navigation username={username} />
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </PlayerProvider>
  );
}

export async function generateMetadata(
  { params }: { params: PlayerLayoutParams },
  parent: ResolvingMetadata,
) {
  const username = await params.then((p) => decodeURIComponent(p.username));
  const [player, metadata] = await Promise.all([
    loadPlayerWithStats(username),
    parent,
  ]);

  if (player === null) {
    return { title: 'Player not found' };
  }

  const counts = challengeCountsByType(player.stats);

  const since =
    player.firstRecorded !== null
      ? ` since ${player.firstRecorded.toLocaleDateString()}`
      : '';

  const summary = `${player.username}'s PvM statistics on Blert${since}`;
  const description =
    counts.length > 0
      ? `${summary}: ` +
        oxford(
          counts.map(({ type, completions, total }) => {
            const rate = Math.round((completions / total) * 100);
            return (
              `${total} ${challengeName(type)} ` +
              `${challengeTerm(type, total !== 1).toLowerCase()} ` +
              `(${rate}% completed)`
            );
          }),
        ) +
        '.'
      : `${summary}.`;

  const images = [
    {
      url: `/images/gear/${PrimaryMeleeGear[PrimaryMeleeGear.BLORVA].toLowerCase()}.webp`,
      width: 160,
      height: 160,
      alt: player.username,
    },
  ];

  return {
    title: player.username,
    description,
    openGraph: {
      ...metadata.openGraph,
      title: `${player.username}'s Stats`,
      description,
      type: 'profile',
      images,
      profile: {
        username: player.username,
      },
      siteName: 'Blert',
      locale: 'en_US',
    },
    twitter: {
      ...metadata.twitter,
      title: `${player.username} | Blert`,
      description,
      images,
      card: 'summary',
    },
    alternates: {
      canonical: `/players/${encodeURIComponent(player.username)}`,
    },
    robots: {
      index: true,
      follow: true,
    },
    keywords: [
      'OSRS',
      'Old School RuneScape',
      'PvM',
      ...counts.map((c) => challengeName(c.type)),
      player.username,
    ],
    authors: [{ name: player.username }],
    category: 'Gaming',
  };
}
