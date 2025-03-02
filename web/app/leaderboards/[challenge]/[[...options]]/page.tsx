import {
  ChallengeMode,
  ChallengeType,
  SplitType,
  adjustSplitForMode,
  splitName,
} from '@blert/common';
import { ResolvingMetadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { RankedSplit, findBestSplitTimes } from '@/actions/challenge';
import Card from '@/components/card';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl } from '@/utils/url';

import styles from './style.module.scss';

function scaleName(scale: number) {
  switch (scale) {
    case 1:
      return 'Solo';
    case 2:
      return 'Duo';
    case 3:
      return 'Trio';
    default:
      return `${scale}s`;
  }
}

function modeName(mode: ChallengeMode) {
  switch (mode) {
    case ChallengeMode.TOB_REGULAR:
      return 'Regular';
    case ChallengeMode.TOB_HARD:
      return 'Hard';
    default:
      return '';
  }
}

function colorForRank(rank: number) {
  if (rank === 1) {
    return '#ffd700';
  }
  if (rank === 2) {
    return '#c0c0c0';
  }
  if (rank === 3) {
    return '#cd7f32';
  }
  return 'var(--blert-text-color)';
}

type LeaderboardProps = {
  challengeType: ChallengeType;
  split: SplitType;
  ranks: RankedSplit[];
};

function Leaderboard({ challengeType, split, ranks }: LeaderboardProps) {
  return (
    <Card header={{ title: splitName(split) }} className={styles.boardCard}>
      <div className={styles.board}>
        {ranks.map((rank, i) => (
          <Link
            key={i}
            className={styles.entry}
            href={challengeUrl(challengeType, rank.uuid)}
          >
            <div className={`${styles.rank}`}>
              {i <= 2 && (
                <span
                  className={`${styles.medal} ${
                    i === 0
                      ? styles.gold
                      : i === 1
                        ? styles.silver
                        : i === 2
                          ? styles.bronze
                          : ''
                  }`}
                >
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                </span>
              )}
              {i + 1}
            </div>
            <div className={styles.wrapper}>
              <div className={styles.timeAndDate}>
                <span className={styles.time}>
                  {ticksToFormattedSeconds(rank.ticks)}
                </span>
                <span className={styles.date}>
                  {new Date(rank.date).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'numeric',
                    day: 'numeric',
                  })}
                </span>
              </div>
              <div className={styles.party}>{rank.party.join(', ')}</div>
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}

type LeaderboardsPageProps = {
  params: Promise<{
    challenge: string;
    options?: string[];
  }>;
};

export default async function LeaderboardsPage(props: LeaderboardsPageProps) {
  const { challenge, options } = await props.params;

  let challengeType: ChallengeType;
  let mode = ChallengeMode.NO_MODE;
  let scale = 1;

  let heading;
  let splits: SplitType[] = [];
  let numHighlightedSplits = 1;

  const linkClass = (active: boolean) =>
    `${styles.option} ${active ? styles.active : ''}`;

  switch (challenge) {
    case 'tob': {
      challengeType = ChallengeType.TOB;
      if (options === undefined || options.length !== 2) {
        redirect('/leaderboards/tob/regular/5');
      }

      scale = parseInt(options[1]);
      if (
        (options[0] !== 'regular' && options[0] !== 'hard') ||
        scale < 1 ||
        scale > 5
      ) {
        redirect('/leaderboards/tob/regular/5');
      }

      mode =
        options[0] === 'hard'
          ? ChallengeMode.TOB_HARD
          : ChallengeMode.TOB_REGULAR;

      heading = (
        <Card className={styles.header} primary>
          <div className={styles.headerTop}>
            <div className={styles.challenges}>
              <Link
                className={linkClass(true)}
                href={`/leaderboards/tob/regular/5`}
              >
                <Image
                  src="/logo_tob.webp"
                  alt="Theatre of Blood"
                  width={24}
                  height={24}
                  style={{ objectFit: 'contain' }}
                />
                Theatre of Blood
              </Link>
              <Link
                className={linkClass(false)}
                href={`/leaderboards/colosseum`}
              >
                <Image
                  src="/varlamore.png"
                  alt="Fortis Colosseum"
                  width={24}
                  height={24}
                  style={{ objectFit: 'contain' }}
                />
                Fortis Colosseum
              </Link>
            </div>
            <div className={styles.modes}>
              <Link
                className={linkClass(mode === ChallengeMode.TOB_REGULAR)}
                href={`/leaderboards/tob/regular/${scale}`}
              >
                <i className="fas fa-circle" style={{ color: '#ffd700' }} />
                Regular
              </Link>
              <Link
                className={linkClass(mode === ChallengeMode.TOB_HARD)}
                href={`/leaderboards/tob/hard/${scale}`}
              >
                <i className="fas fa-circle" style={{ color: '#d100cc' }} />
                Hard
              </Link>
            </div>
          </div>
          <div className={styles.scales}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Link
                className={linkClass(scale === i + 1)}
                href={`/leaderboards/tob/${modeName(mode).toLowerCase()}/${i + 1}`}
                key={i}
              >
                {scaleName(i + 1)}
              </Link>
            ))}
          </div>
        </Card>
      );

      splits = [
        SplitType.TOB_CHALLENGE,
        SplitType.TOB_OVERALL,
        SplitType.TOB_MAIDEN,
        SplitType.TOB_BLOAT,
        SplitType.TOB_NYLO_ROOM,
        SplitType.TOB_SOTETSEG,
        SplitType.TOB_XARPUS,
        SplitType.TOB_VERZIK_ROOM,
      ].map((split) => adjustSplitForMode(split, mode));
      numHighlightedSplits = 2;
      break;
    }

    case 'colosseum': {
      challengeType = ChallengeType.COLOSSEUM;
      heading = (
        <Card className={styles.header} primary>
          <div className={styles.headerTop}>
            <div className={styles.challenges}>
              <Link
                className={linkClass(false)}
                href={`/leaderboards/tob/regular/5`}
              >
                <Image
                  src="/logo_tob.webp"
                  alt="Theatre of Blood"
                  width={24}
                  height={24}
                  style={{ objectFit: 'contain' }}
                />
                Theatre of Blood
              </Link>
              <Link
                className={linkClass(true)}
                href={`/leaderboards/colosseum`}
              >
                <Image
                  src="/varlamore.png"
                  alt="Fortis Colosseum"
                  width={24}
                  height={24}
                  style={{ objectFit: 'contain' }}
                />
                Fortis Colosseum
              </Link>
            </div>
          </div>
        </Card>
      );
      splits = [
        SplitType.COLOSSEUM_CHALLENGE,
        SplitType.COLOSSEUM_WAVE_1,
        SplitType.COLOSSEUM_WAVE_2,
        SplitType.COLOSSEUM_WAVE_3,
        SplitType.COLOSSEUM_WAVE_4,
        SplitType.COLOSSEUM_WAVE_5,
        SplitType.COLOSSEUM_WAVE_6,
        SplitType.COLOSSEUM_WAVE_7,
        SplitType.COLOSSEUM_WAVE_8,
        SplitType.COLOSSEUM_WAVE_9,
        SplitType.COLOSSEUM_WAVE_10,
        SplitType.COLOSSEUM_WAVE_11,
        SplitType.COLOSSEUM_WAVE_12,
      ];
      break;
    }

    default:
      return 'Not Found';
  }

  const rankedSplits = await findBestSplitTimes(splits, scale, 3);

  return (
    <div className={styles.leaderboards}>
      <div className={styles.inner}>
        {heading}
        <div className={styles.boardGrid}>
          {splits.slice(0, numHighlightedSplits).map((split, i) => (
            <Leaderboard
              key={i}
              challengeType={challengeType}
              split={split}
              ranks={rankedSplits[split] ?? []}
            />
          ))}
        </div>
        <div className={styles.boardGrid}>
          {splits.slice(numHighlightedSplits).map((split, i) => (
            <Leaderboard
              key={i}
              challengeType={challengeType}
              split={split}
              ranks={rankedSplits[split] ?? []}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export async function generateMetadata(
  { params }: LeaderboardsPageProps,
  parent: ResolvingMetadata,
) {
  const { challenge, options } = await params;
  const metadata = await parent;

  let title = 'OSRS Leaderboards';
  let description = '';
  let imageUrl = '';

  switch (challenge) {
    case 'tob': {
      let mode = ChallengeMode.NO_MODE;
      let scale = 1;
      imageUrl = 'https://blert.io/logo_tob.webp';

      if (options === undefined || options.length !== 2) {
        title = 'Theatre of Blood Leaderboards';
        description =
          'View the fastest Theatre of Blood raid times on Blert, including room splits, party compositions, and detailed analytics for all team sizes.';
      } else {
        mode =
          options[0] === 'hard'
            ? ChallengeMode.TOB_HARD
            : ChallengeMode.TOB_REGULAR;
        scale = parseInt(options[1]);

        const modeStr = modeName(mode);
        const scaleStr = scaleName(scale);
        title = `${scaleStr} ${modeStr} Theatre of Blood Leaderboards`;
        description = `Track the fastest ${modeStr} Mode Theatre of Blood ${scaleStr} raid times. Compare room splits, view party compositions, and analyze strategies from top teams.`;
      }
      break;
    }

    case 'colosseum': {
      title = 'Fortis Colosseum Leaderboards';
      description =
        'Track the fastest Fortis Colosseum wave times and completions. View detailed wave splits, strategies, and records from top OSRS PvMers.';
      imageUrl = 'https://blert.io/varlamore.png';
      break;
    }

    default:
      return { title: 'Not Found' };
  }

  return {
    title,
    description,
    openGraph: {
      ...metadata.openGraph,
      title,
      description,
      images: [
        {
          url: imageUrl,
          width: 200,
          height: 200,
          alt: title,
        },
      ],
    },
    twitter: {
      ...metadata.twitter,
      title,
      description,
      images: [imageUrl],
      card: 'summary',
    },
  };
}
