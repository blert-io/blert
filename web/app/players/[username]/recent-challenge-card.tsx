'use client';

import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  Stage,
  challengeName,
} from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import TimeAgo from 'react-timeago';

import { useClientOnly } from '@/hooks/client-only';
import { useVisibleInterval } from '@/hooks/visible-interval';
import { challengeLogo } from '@/logo';
import {
  modeNameAndColor,
  scaleNameAndColor,
  statusNameAndColor,
} from '@/utils/challenge';
import { challengeUrl } from '@/utils/url';

import styles from './style.module.scss';

export type RecentChallenge = {
  uuid: string;
  type: ChallengeType;
  status: ChallengeStatus;
  stage: Stage;
  mode: ChallengeMode;
  scale: number;
  startTime: string;
};

type RecentChallengeCardProps = {
  username: string;
  initial: RecentChallenge | null;
};

/** How often to refresh the most recent challenge while the tab is visible. */
const POLL_INTERVAL_MS = 30_000;

/**
 * Displays a player's most recent challenge as a link, lighting up with a live
 * indicator whenever that challenge is in progress.
 */
export default function RecentChallengeCard({
  username,
  initial,
}: RecentChallengeCardProps) {
  const [challenge, setChallenge] = useState<RecentChallenge | null>(initial);
  const isClient = useClientOnly();
  const abortRef = useRef<AbortController | null>(null);

  useVisibleInterval(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetch(`/api/v1/challenges?party=${encodeURIComponent(username)}&limit=1`, {
      signal: controller.signal,
    })
      .then((res) =>
        res.ok ? (res.json() as Promise<RecentChallenge[]>) : null,
      )
      .then((data) => {
        if (data !== null) {
          setChallenge(data.length > 0 ? data[0] : null);
        }
      })
      .catch(() => {
        // Ignore aborts and transient network errors; the next tick retries.
      });
  }, POLL_INTERVAL_MS);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (challenge === null) {
    return null;
  }

  const isLive = challenge.status === ChallengeStatus.IN_PROGRESS;
  const [scaleString] = scaleNameAndColor(challenge.scale);
  const [modeString] = modeNameAndColor(challenge.type, challenge.mode, false);
  const [statusLabel, statusColor] = statusNameAndColor(
    challenge.status,
    challenge.stage,
  );

  return (
    <Link
      href={challengeUrl(challenge.type, challenge.uuid)}
      className={`${styles.recentChallenge} ${isLive ? styles.live : ''}`}
    >
      <div className={styles.recentLogo}>
        <Image
          src={challengeLogo(challenge.type)}
          alt={challengeName(challenge.type)}
          width={32}
          height={32}
          style={{ objectFit: 'contain' }}
        />
      </div>
      <div className={styles.recentBody}>
        <div className={styles.recentLabel}>
          {isLive ? (
            <span className={styles.liveIndicator}>
              <span className={styles.pulsingDot} />
              Live
            </span>
          ) : (
            'Most recent'
          )}
        </div>
        <div className={styles.recentTitle}>
          {challengeName(challenge.type)}{' '}
          <span className={styles.recentMeta}>
            ({scaleString}
            {challenge.mode !== ChallengeMode.NO_MODE && `, ${modeString}`})
          </span>
        </div>
        <div className={styles.recentStatus}>
          {!isLive && <span style={{ color: statusColor }}>{statusLabel}</span>}
          {isClient && (
            <span className={styles.recentTime}>
              <TimeAgo date={challenge.startTime} />
            </span>
          )}
        </div>
      </div>
      <i className={`fas fa-chevron-right ${styles.recentArrow}`} />
    </Link>
  );
}
