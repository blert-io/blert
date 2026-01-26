'use server';

import { PrimaryMeleeGear, SplitType } from '@blert/common';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { ResolvingMetadata } from 'next';

import {
  aggregateChallenges,
  loadPbsForPlayer,
  loadPlayerWithStats,
  type PlayerWithStats,
} from '@/actions/challenge';
import { isFollowing } from '@/actions/feed';
import { getConnectedPlayers, getSignedInUserId } from '@/actions/users';
import { ticksToFormattedSeconds } from '@/utils/tick';

import FollowButton from './follow-button';

function scaleName(scale: number) {
  return scale === 1
    ? 'Solo'
    : scale === 2
      ? 'Duo'
      : scale === 3
        ? 'Trio'
        : scale === 4
          ? '4s'
          : '5s';
}

import { PlayerProvider } from './player-context';
import Navigation from './navigation';

import styles from './style.module.scss';

export type PlayerLayoutParams = Promise<{ username: string }>;

type PlayerLayoutProps = {
  children: React.ReactNode;
  params: PlayerLayoutParams;
};

function PlayerInfo({
  player,
  totalRecordedTicks,
  followButton,
}: {
  player: PlayerWithStats;
  totalRecordedTicks: number;
  followButton: React.ReactNode;
}) {
  const totalHoursPlayed = (totalRecordedTicks / 6000).toFixed(1);

  const totalRaids =
    player.stats.tobCompletions +
    player.stats.tobWipes +
    player.stats.tobResets;
  const completionRate =
    totalRaids > 0
      ? ((player.stats.tobCompletions / totalRaids) * 100).toFixed(1)
      : '0.0';

  const deathsPerRaid =
    totalRaids > 0 ? (player.stats.deathsTotal / totalRaids).toFixed(1) : '0.0';

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
              {player.firstRecorded.toLocaleDateString()}
            </span>
          </div>
          <div className={styles.statRow}>
            <span className={styles.label}>
              <i className="fa-solid fa-chart-simple" /> Completion rate
            </span>
            <span className={styles.value}>
              {completionRate}% ({player.stats.tobCompletions}/{totalRaids})
            </span>
          </div>
          <div className={styles.statRow}>
            <span className={styles.label}>
              <i className="fa-solid fa-skull" /> Deaths per raid
            </span>
            <span className={styles.value}>{deathsPerRaid}</span>
          </div>
          <div className={styles.statRow}>
            <span className={styles.label}>
              <i className="fa-solid fa-hourglass" /> Time played
            </span>
            <span className={styles.value}>{totalHoursPlayed} hours</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function PlayerLayout({
  children,
  params,
}: PlayerLayoutProps) {
  const username = await params.then((u) => decodeURIComponent(u.username));
  const [player, totalRecordedTicks, personalBests, userId] = await Promise.all(
    [
      loadPlayerWithStats(username),
      aggregateChallenges(
        {
          party: [username],
        },
        { challengeTicks: 'sum' },
      ),
      loadPbsForPlayer(username),
      getSignedInUserId(),
    ],
  );

  if (player === null) {
    return notFound();
  }

  const isSignedIn = userId !== null;
  const connectedPlayers = isSignedIn ? await getConnectedPlayers() : [];
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
            totalRecordedTicks={totalRecordedTicks?.challengeTicks.sum ?? 0}
            followButton={followButton}
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
  const [player, personalBests, metadata] = await Promise.all([
    loadPlayerWithStats(username),
    loadPbsForPlayer(username),
    parent,
  ]);

  if (player === null) {
    return { title: 'Player not found' };
  }

  let bestTobTime: number | null = null;
  let bestTobScale: number | null = null;
  for (const pb of personalBests) {
    if (pb.type === SplitType.TOB_REG_CHALLENGE) {
      if (bestTobTime === null || pb.ticks < bestTobTime) {
        bestTobTime = pb.ticks;
        bestTobScale = pb.scale;
      }
    }
  }

  const stats = player.stats;
  const totalRaids = stats.tobCompletions + stats.tobWipes + stats.tobResets;
  const completionRate =
    totalRaids > 0 ? Math.round((stats.tobCompletions / totalRaids) * 100) : 0;

  const description =
    `${player.username}'s Theatre of Blood statistics on Blert since ${player.firstRecorded.toLocaleDateString()}: ` +
    `${stats.tobCompletions} completion${stats.tobCompletions === 1 ? '' : 's'} ` +
    `out of ${totalRaids} raid${totalRaids === 1 ? '' : 's'}, ` +
    `with a ${completionRate}% success rate. ` +
    (bestTobTime !== null
      ? `Best time: ${ticksToFormattedSeconds(bestTobTime)} (${scaleName(bestTobScale!)}). `
      : '') +
    `${stats.deathsTotal} total deaths.`;

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
      'Theatre of Blood',
      'ToB',
      'PvM',
      player.username,
      'raid statistics',
    ],
    authors: [{ name: player.username }],
    category: 'Gaming',
  };
}
