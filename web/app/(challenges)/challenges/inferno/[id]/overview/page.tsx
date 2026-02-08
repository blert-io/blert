'use client';

import { InfernoChallenge } from '@blert/common';
import { useContext } from 'react';

import { ChallengeContext } from '@/challenge-context';
import ChallengeOverview from '@/components/challenge-overview';
import Loading from '@/components/loading';

import { InfernoWavesOverview } from './waves-overview';

import styles from './style.module.scss';

export default function Overview() {
  const [challenge] = useContext(ChallengeContext) as [
    InfernoChallenge | null,
    unknown,
  ];

  if (challenge === null) {
    return <Loading />;
  }

  return (
    <div className={styles.inferno}>
      <ChallengeOverview
        type={challenge.type}
        stage={challenge.stage}
        status={challenge.status}
        mode={challenge.mode}
        challengeTicks={challenge.challengeTicks}
        deaths={challenge.totalDeaths}
        party={challenge.party.map((player) => ({
          ...player,
          stageDeaths: [],
        }))}
        startTime={challenge.startTime}
        extraInfo={[]}
      />
      <InfernoWavesOverview challenge={challenge} />
    </div>
  );
}
