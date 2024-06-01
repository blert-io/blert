import {
  ChallengeMode,
  ChallengeType,
  SplitType,
  adjustSplitForMode,
  splitName,
} from '@blert/common';
import { ResolvingMetadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { RankedSplit, findBestSplitTimes } from '@/actions/challenge';
import CollapsiblePanel from '@/components/collapsible-panel';
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
    <CollapsiblePanel
      className={styles.boardPanel}
      panelTitle={splitName(split)}
      maxPanelHeight={2000}
      disableExpansion
      key={split}
    >
      <div className={styles.board}>
        {ranks.map((rank, i) => (
          <Link
            href={challengeUrl(challengeType, rank.uuid)}
            className={styles.entry}
            key={i}
          >
            <div className={styles.rank} style={{ color: colorForRank(i + 1) }}>
              {i + 1}
            </div>
            <div className={styles.wrapper}>
              <div className={styles.timeAndDate}>
                <div className={styles.time}>
                  {ticksToFormattedSeconds(rank.ticks)}
                </div>
                <div className={styles.date}>
                  {new Date(rank.date).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'numeric',
                    day: 'numeric',
                  })}
                </div>
              </div>
              <span className={styles.party}>{rank.party.join(', ')}</span>
            </div>
          </Link>
        ))}
      </div>
    </CollapsiblePanel>
  );
}

const DEFAULT_SPLITS = [
  SplitType.TOB_CHALLENGE,
  SplitType.TOB_MAIDEN,
  SplitType.TOB_BLOAT,
  SplitType.TOB_NYLO_ROOM,
  SplitType.TOB_SOTETSEG,
  SplitType.TOB_XARPUS,
  SplitType.TOB_VERZIK_ROOM,
];

type LeaderboardsPageProps = {
  params: {
    challenge: string;
    options?: string[];
  };
};

export default async function LeaderboardsPage(props: LeaderboardsPageProps) {
  const { challenge, options } = props.params;

  const challengeType = challenge === 'tob' ? ChallengeType.TOB : null;

  if (challengeType === null) {
    return 'Not Found';
  }

  let mode = ChallengeMode.NO_MODE;
  let scale = 1;

  switch (challengeType) {
    case ChallengeType.TOB: {
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
      break;
    }
  }

  const adjustedSplits = DEFAULT_SPLITS.map((s) => adjustSplitForMode(s, mode));
  const rankedSplits = await findBestSplitTimes(adjustedSplits, scale, 3);

  const linkClass = (active: boolean) =>
    `${styles.option} ${active ? styles.active : ''}`;

  return (
    <div className={styles.leaderboards}>
      <div className={styles.controls}>
        <h1>
          Theatre of Blood ({scaleName(scale)} {modeName(mode)})
        </h1>
        <div className={styles.options}>
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
        <div className={styles.options}>
          <Link
            className={linkClass(mode === ChallengeMode.TOB_REGULAR)}
            href={`/leaderboards/tob/regular/${scale}`}
          >
            <i
              className={`far fa-circle${mode === ChallengeMode.TOB_REGULAR ? '-check' : ''}`}
              style={{ marginRight: 8, color: '#ffd700' }}
            />
            Regular
          </Link>
          <Link
            className={linkClass(mode === ChallengeMode.TOB_HARD)}
            href={`/leaderboards/tob/hard/${scale}`}
          >
            <i
              className={`far fa-circle${mode === ChallengeMode.TOB_HARD ? '-check' : ''}`}
              style={{ marginRight: 8, color: '#d100cc' }}
            />
            Hard
          </Link>
        </div>
      </div>
      <div className={styles.boardGroup}>
        {rankedSplits[adjustedSplits[0]] !== undefined && (
          <Leaderboard
            challengeType={challengeType}
            split={adjustedSplits[0]}
            ranks={rankedSplits[adjustedSplits[0]]!}
          />
        )}
      </div>
      <div className={styles.boardGroup}>
        {adjustedSplits
          .slice(1)
          .filter((split) => rankedSplits[split] !== undefined)
          .map((split) => (
            <Leaderboard
              key={split}
              challengeType={challengeType}
              split={split}
              ranks={rankedSplits[split]!}
            />
          ))}
      </div>
    </div>
  );
}

export async function generateMetadata(
  { params }: LeaderboardsPageProps,
  parent: ResolvingMetadata,
) {
  const { challenge, options } = params;
  const challengeType = challenge === 'tob' ? ChallengeType.TOB : null;

  if (challengeType === null) {
    return { title: 'Not Found' };
  }

  let mode = ChallengeMode.NO_MODE;
  let scale = 1;

  let title = 'Leaderboards';
  let description = '';

  switch (challengeType) {
    case ChallengeType.TOB: {
      if (options === undefined || options.length !== 2) {
        title = 'Theatre of Blood Leaderboards';
        description = `View the best recorded times for the Theatre of Blood raids on Blert, Old School RuneScape's premier PvM tracker.`;
      } else {
        mode =
          options![0] === 'hard'
            ? ChallengeMode.TOB_HARD
            : ChallengeMode.TOB_REGULAR;
        scale = parseInt(options![1]);

        title = `Theatre of Blood (${scaleName(scale)} ${modeName(mode)}) Leaderboards`;
        description =
          `View the best recorded times for Theatre of Blood ` +
          `${modeName(mode)} Mode ${scaleName(scale)} ` +
          `raids on Blert, Old School RuneScape's premier PvM tracker.`;
      }
      break;
    }
  }

  const metadata = await parent;

  return {
    title,
    description,
    openGraph: { ...metadata.openGraph, description },
    twitter: {
      ...metadata.twitter,
      title,
      description,
    },
  };
}
