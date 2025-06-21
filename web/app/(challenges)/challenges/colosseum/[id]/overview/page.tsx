'use client';

import { ColosseumChallenge } from '@blert/common';
import { useContext } from 'react';

import { ChallengeContext } from '@/challenge-context';
import ChallengeOverview from '@/components/challenge-overview';
import ColosseumHandicap from '@/components/colosseum-handicap';
import Loading from '@/components/loading';
import { PvMContent } from '@/components/pvm-content-logo';

import { ColosseumWavesOverview } from './waves-overview';

import styles from './style.module.scss';

export default function Overview() {
  const [challenge] = useContext(ChallengeContext) as [
    ColosseumChallenge | null,
    unknown,
  ];

  if (challenge === null) {
    return <Loading />;
  }

  return (
    <div className={styles.colosseum}>
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
        pvmContent={PvMContent.Colosseum}
        extraInfo={[
          {
            label: 'Handicaps',
            value: (
              <div className={styles.handicapsList}>
                {challenge.colosseum.handicaps.map((handicap) => (
                  <ColosseumHandicap key={handicap} handicap={handicap} />
                ))}
              </div>
            ),
            span: 2,
          },
        ]}
      />
      <ColosseumWavesOverview challenge={challenge} />
    </div>
  );
}
