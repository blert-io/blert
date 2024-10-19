'use client';

import { ChallengeMode, ChallengeStatus, ChallengeType } from '@blert/common';
import Link from 'next/link';
import { Suspense, useDeferredValue, useEffect, useState } from 'react';

import { ChallengeOverview } from '../../actions/challenge';
import { RaidQuickDetails } from '../raid-quick-details/raid-quick-details';
import { challengeUrl, queryString } from '../../utils/url';

import styles from './style.module.scss';

export type ChallengeHistoryProps = {
  count: number;
  initialChallenges?: ChallengeOverview[];
  mode?: ChallengeMode;
  type?: ChallengeType;
  scale?: number;
  status?: ChallengeStatus | ChallengeStatus[];
  username?: string;
};

function ChallengeList({ challenges }: { challenges: ChallengeOverview[] }) {
  if (challenges.length === 0) {
    return <div className={styles.message}>No challenges found</div>;
  }

  return (
    <>
      {challenges.map((challenge) => (
        <Link
          href={challengeUrl(challenge.type, challenge.uuid)}
          key={challenge.uuid}
        >
          <div className={styles.recentRaid}>
            <div className={styles.recentRaidTeam}>
              <span style={{ fontWeight: 'bold' }}>Players: </span>
              {challenge.party.map((p) => p.username).join(', ')}
            </div>
            <RaidQuickDetails
              type={challenge.type}
              stage={challenge.stage}
              status={challenge.status}
              mode={challenge.mode}
              totalRaidTicks={challenge.challengeTicks}
              deaths={challenge.totalDeaths}
              partySize={challenge.party.length}
              startTime={challenge.startTime}
              compactView
            />
          </div>
        </Link>
      ))}
    </>
  );
}

export default function ChallengeHistory(props: ChallengeHistoryProps) {
  const {
    count,
    type,
    mode,
    scale,
    username,
    initialChallenges = [],
    status,
  } = props;

  const [challenges, setChallenges] = useState(initialChallenges);
  const deferredChallenges = useDeferredValue(challenges);

  useEffect(() => {
    const fetchChallenges = async () => {
      const params = {
        limit: count.toString(),
        type: type?.toString(),
        party: username ? [username] : undefined,
        scale: scale?.toString(),
        mode: mode?.toString(),
        status: status
          ? Array.isArray(status)
            ? status
            : [status]
          : undefined,
      };
      const challenges = await fetch(
        `/api/v1/challenges?${queryString(params)}`,
      ).then((res) => res.json());
      setChallenges(challenges);
    };

    fetchChallenges();
    const refetchInterval = window.setInterval(fetchChallenges, 30 * 1000);
    return () => window.clearInterval(refetchInterval);
  }, [count, type, username, scale, mode, status]);

  return (
    <div className={styles.history}>
      <Suspense fallback={<div className={styles.message}>Loading...</div>}>
        <ChallengeList challenges={deferredChallenges} />
      </Suspense>
    </div>
  );
}
