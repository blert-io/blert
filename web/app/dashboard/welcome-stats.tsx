import { ChallengeMode, challengeName, ChallengeType } from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';

import { ChallengeOverview } from '@/actions/challenge';
import { challengeLogo } from '@/logo';
import { scaleNameAndColor } from '@/utils/challenge';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl } from '@/utils/url';

import styles from './welcome-stats.module.scss';

/**
 * Formats a challenge name with scale and mode for display.
 * e.g., "ToB 4s", "HMT 4s", "Colosseum", "Inferno"
 *
 * @param type The challenge type.
 * @param scale The challenge scale.
 * @param mode The challenge mode.
 * @returns The formatted challenge name.
 */
function formatChallengeName(
  type: ChallengeType,
  scale: number,
  mode: ChallengeMode,
): string {
  const [scaleName] = scaleNameAndColor(scale);

  if (
    type === ChallengeType.COLOSSEUM ||
    type === ChallengeType.INFERNO ||
    type === ChallengeType.MOKHAIOTL
  ) {
    return challengeName(type);
  }

  if (mode === ChallengeMode.TOB_REGULAR) {
    return `ToB ${scaleName}`;
  }
  if (mode === ChallengeMode.TOB_HARD) {
    return `HMT ${scaleName}`;
  }
  if (mode === ChallengeMode.TOB_ENTRY) {
    return `ToB entry ${scaleName}`;
  }

  return `ToB ${scaleName}`;
}

type QuickStats = {
  recordings: number;
  completions: number;
  timeRecorded: string;
};

type WeekActivity = {
  type: ChallengeType;
  mode: ChallengeMode;
  scale: number;
  count: number;
};

type WelcomeStatsProps = {
  username: string;
  stats: QuickStats;
  lastChallenge: ChallengeOverview | null;
  thisWeek: WeekActivity[];
};

export default function WelcomeStats({
  username,
  stats,
  lastChallenge,
  thisWeek,
}: WelcomeStatsProps) {
  const welcome = stats.recordings > 0 ? 'Welcome back' : 'Welcome to Blert';

  return (
    <div className={styles.welcomeStats}>
      <div className={styles.welcomeMain}>
        <div className={styles.welcomeText}>
          <h1>
            {welcome}, {username}
          </h1>
          <p className={styles.subtitle}>Your activity at a glance</p>
        </div>
        <div className={styles.quickStats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{stats.recordings}</span>
            <span className={styles.statLabel}>Challenges</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{stats.completions}</span>
            <span className={styles.statLabel}>Completions</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{stats.timeRecorded}</span>
            <span className={styles.statLabel}>Time Played</span>
          </div>
        </div>
      </div>
      <div className={styles.welcomeBottom}>
        {lastChallenge !== null && (
          <div className={styles.lastChallenge}>
            <div className={styles.sectionHeader}>
              <i className="fas fa-clock-rotate-left" />
              <span>Last Challenge</span>
            </div>
            <Link
              href={challengeUrl(lastChallenge.type, lastChallenge.uuid)}
              className={styles.lastChallengeContent}
            >
              <div className={styles.challengeTop}>
                <span className={styles.challengeType}>
                  {formatChallengeName(
                    lastChallenge.type,
                    lastChallenge.scale,
                    lastChallenge.mode,
                  )}
                </span>
                <span className={styles.challengeTime}>
                  {ticksToFormattedSeconds(lastChallenge.challengeTicks)}
                </span>
              </div>
              <div className={styles.challengeBottom}>
                <span className={styles.challengeDate}>
                  {lastChallenge.startTime.toLocaleDateString()}
                </span>
                <span className={styles.viewChallenge}>
                  View <i className="fas fa-arrow-right" />
                </span>
              </div>
            </Link>
          </div>
        )}
        <div className={styles.thisWeek}>
          <div className={styles.sectionHeader}>
            <i className="fas fa-calendar-week" />
            <span>This Week</span>
          </div>
          <div className={styles.thisWeekContent}>
            {thisWeek.length > 0 ? (
              thisWeek.map((activity, i) => (
                <div key={i} className={styles.activityCard}>
                  <Image
                    src={challengeLogo(activity.type)}
                    alt=""
                    width={24}
                    height={24}
                    className={styles.activityIcon}
                  />
                  <div className={styles.activityInfo}>
                    <span className={styles.activityName}>
                      {formatChallengeName(
                        activity.type,
                        activity.scale,
                        activity.mode,
                      )}
                    </span>
                    <span className={styles.activityCount}>
                      {activity.count} {activity.count === 1 ? 'run' : 'runs'}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.noActivity}>
                <i className="fas fa-person-running" />
                <span>Time to get some raids in!</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
