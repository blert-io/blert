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
import { notFound, redirect } from 'next/navigation';

import { findBestSplitTimes, findChallenges } from '@/actions/challenge';
import Card from '@/components/card';
import { challengeLogo } from '@/logo';
import { scaleNameAndColor } from '@/utils/challenge';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl } from '@/utils/url';

import styles from './style.module.scss';

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

type Rank = {
  uuid: string;
  date: Date;
  party: string[];
  value: number | string;
};

type LeaderboardProps = {
  challengeType: ChallengeType;
  ranks: Rank[];
  title: string;
};

function Leaderboard({ challengeType, ranks, title }: LeaderboardProps) {
  return (
    <Card header={{ title }} className={styles.boardCard}>
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
                <span className={styles.time}>{rank.value}</span>
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

  let splits: SplitType[] = [];
  let numHighlightedSplits = 1;

  const linkClass = (active: boolean) =>
    `${styles.option} ${active ? styles.active : ''}`;

  let headerModes;
  let headerScales;

  const customLeaderboards: LeaderboardProps[] = [];

  switch (challenge) {
    case 'tob': {
      challengeType = ChallengeType.TOB;
      if (options?.length !== 2) {
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

      headerModes = (
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
      );

      headerScales = (
        <div className={styles.scales}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Link
              className={linkClass(scale === i + 1)}
              href={`/leaderboards/tob/${modeName(mode).toLowerCase()}/${i + 1}`}
              key={i}
            >
              {scaleNameAndColor(i + 1)[0]}
            </Link>
          ))}
        </div>
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

    case 'inferno': {
      challengeType = ChallengeType.INFERNO;
      splits = [
        SplitType.INFERNO_CHALLENGE,
        SplitType.INFERNO_WAVE_9_START,
        SplitType.INFERNO_WAVE_18_START,
        SplitType.INFERNO_WAVE_25_START,
        SplitType.INFERNO_WAVE_35_START,
        SplitType.INFERNO_WAVE_42_START,
        SplitType.INFERNO_WAVE_50_START,
        SplitType.INFERNO_WAVE_57_START,
        SplitType.INFERNO_WAVE_60_START,
        SplitType.INFERNO_WAVE_63_START,
        SplitType.INFERNO_WAVE_66_START,
        SplitType.INFERNO_WAVE_68_START,
        SplitType.INFERNO_WAVE_69_START,
      ];
      break;
    }

    case 'colosseum': {
      challengeType = ChallengeType.COLOSSEUM;
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

    case 'mokhaiotl': {
      challengeType = ChallengeType.MOKHAIOTL;
      splits = [
        SplitType.MOKHAIOTL_CHALLENGE,
        SplitType.MOKHAIOTL_DELVE_1,
        SplitType.MOKHAIOTL_DELVE_2,
        SplitType.MOKHAIOTL_DELVE_3,
        SplitType.MOKHAIOTL_DELVE_4,
        SplitType.MOKHAIOTL_DELVE_5,
        SplitType.MOKHAIOTL_DELVE_6,
        SplitType.MOKHAIOTL_DELVE_7,
        SplitType.MOKHAIOTL_DELVE_8,
      ];

      const [topDelves] = await findChallenges(
        3,
        {
          type: ['==', ChallengeType.MOKHAIOTL],
          sort: ['-mok:maxCompletedDelve', '+startTime'],
        },
        { extraFields: { stats: true } },
      );
      customLeaderboards.push({
        challengeType: ChallengeType.MOKHAIOTL,
        ranks: topDelves.map((challenge) => ({
          uuid: challenge.uuid,
          date: challenge.startTime,
          party: challenge.party.map((player) => player.username),
          value: challenge.mokhaiotlStats?.maxCompletedDelve
            ? `Delve ${challenge.mokhaiotlStats.maxCompletedDelve}`
            : 'N/A',
        })),
        title: 'Deepest Delves',
      });
      break;
    }

    default:
      notFound();
  }

  const heading = (
    <Card className={styles.header} primary>
      <div className={styles.headerTop}>
        <div className={styles.challenges}>
          <Link
            className={linkClass(challengeType === ChallengeType.TOB)}
            href={`/leaderboards/tob/regular/5`}
          >
            <Image
              src={challengeLogo(ChallengeType.TOB)}
              alt="Theatre of Blood"
              width={24}
              height={24}
              style={{ objectFit: 'contain' }}
            />
            Theatre of Blood
          </Link>
          <Link
            className={linkClass(challengeType === ChallengeType.INFERNO)}
            href={`/leaderboards/inferno`}
          >
            <Image
              src={challengeLogo(ChallengeType.INFERNO)}
              alt="Inferno"
              width={24}
              height={24}
              style={{ objectFit: 'contain' }}
            />
            Inferno
          </Link>
          <Link
            className={linkClass(challengeType === ChallengeType.COLOSSEUM)}
            href={`/leaderboards/colosseum`}
          >
            <Image
              src={challengeLogo(ChallengeType.COLOSSEUM)}
              alt="Fortis Colosseum"
              width={24}
              height={24}
              style={{ objectFit: 'contain' }}
            />
            Fortis Colosseum
          </Link>
          <Link
            className={linkClass(challengeType === ChallengeType.MOKHAIOTL)}
            href={`/leaderboards/mokhaiotl`}
          >
            <Image
              src={challengeLogo(ChallengeType.MOKHAIOTL)}
              alt="Doom of Mokhaiotl"
              width={24}
              height={24}
              style={{ objectFit: 'contain' }}
            />
            Doom of Mokhaiotl
          </Link>
        </div>
        {headerModes}
      </div>
      {headerScales}
    </Card>
  );

  const rankedSplits = await findBestSplitTimes(splits, scale, 3);

  return (
    <div className={styles.leaderboards}>
      <div className={styles.inner}>
        {heading}
        <div className={styles.boardGrid}>
          {customLeaderboards.map((leaderboard, i) => (
            <Leaderboard key={i} {...leaderboard} />
          ))}
          {splits.slice(0, numHighlightedSplits).map((split, i) => (
            <Leaderboard
              key={i}
              challengeType={challengeType}
              title={splitName(split)}
              ranks={
                rankedSplits[split]?.map((split) => ({
                  uuid: split.uuid,
                  date: split.date,
                  party: split.party,
                  value: ticksToFormattedSeconds(split.ticks),
                })) ?? []
              }
            />
          ))}
        </div>
        <div className={styles.boardGrid}>
          {splits.slice(numHighlightedSplits).map((split, i) => (
            <Leaderboard
              key={i}
              challengeType={challengeType}
              title={splitName(split)}
              ranks={
                rankedSplits[split]?.map((split) => ({
                  uuid: split.uuid,
                  date: split.date,
                  party: split.party,
                  value: ticksToFormattedSeconds(split.ticks),
                })) ?? []
              }
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
      imageUrl = 'https://blert.io/images/tob.webp';

      if (options?.length !== 2) {
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
        const scaleStr = scaleNameAndColor(scale)[0];
        title = `${scaleStr} ${modeStr} Theatre of Blood Leaderboards`;
        description = `Track the fastest ${modeStr} Mode Theatre of Blood ${scaleStr} raid times. Compare room splits, view party compositions, and analyze strategies from top teams.`;
      }
      break;
    }

    case 'inferno': {
      title = 'Inferno Leaderboards';
      description =
        'Track the fastest Inferno raid times and completions. View detailed raid splits, strategies, and records from top OSRS PvMers.';
      imageUrl = 'https://blert.io/images/inferno.png';
      break;
    }

    case 'colosseum': {
      title = 'Fortis Colosseum Leaderboards';
      description =
        'Track the fastest Fortis Colosseum wave times and completions. View detailed wave splits, strategies, and records from top OSRS PvMers.';
      imageUrl = 'https://blert.io/varlamore.png';
      break;
    }

    case 'mokhaiotl': {
      title = 'Doom of Mokhaiotl Leaderboards';
      description =
        'Track the fastest Doom of Mokhaiotl delve times and completions. View detailed delve splits, strategies, and records from top OSRS PvMers.';
      imageUrl = 'https://blert.io/images/mokhaiotl.webp';
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
