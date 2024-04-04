'use client';

import { ChallengeType } from '@blert/common';
import Link from 'next/link';
import { Suspense, useDeferredValue, useEffect, useState } from 'react';

import { ChallengeOverview } from '../../actions/challenge';
import { RaidQuickDetails } from '../raid-quick-details/raid-quick-details';
import { challengeUrl, queryString } from '../../utils/url';

import styles from './style.module.scss';

export type ChallengeHistoryProps = {
  count: number;
  type?: ChallengeType;
  username?: string;
  initialChallenges: ChallengeOverview[];
};

function ChallengeList({ challenges }: { challenges: ChallengeOverview[] }) {
  if (challenges.length === 0) {
    return <div className={styles.message}>No challenges found</div>;
  }

  return (
    <>
      {challenges.map((challenge) => (
        <Link
          href={challengeUrl(challenge.type, challenge._id)}
          key={challenge._id}
        >
          <div className={styles.recentRaid}>
            <div className={styles.recentRaidTeam}>
              <span style={{ fontWeight: 'bold' }}>Players: </span>
              {challenge.party.join(', ')}
            </div>
            <RaidQuickDetails
              type={challenge.type}
              stage={challenge.stage}
              status={challenge.status}
              mode={challenge.mode}
              totalRaidTicks={challenge.totalTicks}
              deaths={challenge.totalDeaths}
              partySize={challenge.party.length}
              startTime={challenge.startTime}
              compactView={true}
            />
          </div>
        </Link>
      ))}
    </>
  );
}

export default async function ChallengeHistory(props: ChallengeHistoryProps) {
  const { count, type, username } = props;

  const [challenges, setChallenges] = useState(props.initialChallenges);
  const deferredChallenges = useDeferredValue(challenges);

  useEffect(() => {
    const fetchChallenges = async () => {
      const params = {
        limit: count.toString(),
        type: type?.toString(),
        username,
      };
      const challenges = await fetch(
        `/api/v1/challenges?${queryString(params)}`,
      ).then((res) => res.json());
      setChallenges(challenges);
    };

    fetchChallenges();
    const refetchInterval = window.setInterval(fetchChallenges, 30 * 1000);
    return () => window.clearInterval(refetchInterval);
  }, [count, type, username]);

  return (
    <div className={styles.history}>
      <Suspense fallback={<div className={styles.message}>Loading...</div>}>
        <ChallengeList challenges={deferredChallenges} />
      </Suspense>
    </div>
  );
}
