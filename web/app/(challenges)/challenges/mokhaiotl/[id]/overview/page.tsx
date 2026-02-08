'use client';

import {
  ChallengeStatus,
  MokhaiotlChallenge,
  SplitType,
  Stage,
} from '@blert/common';
import { useContext } from 'react';

import { ChallengeContext } from '@/challenge-context';
import ChallengeOverview, {
  ExtraOverviewInfo,
} from '@/components/challenge-overview';
import Loading from '@/components/loading';
import { ticksToFormattedSeconds } from '@/utils/tick';

import DelvesOverview from './delves-overview';

import styles from './style.module.scss';

export default function Overview() {
  const [challenge] = useContext(ChallengeContext) as [
    MokhaiotlChallenge | null,
    unknown,
  ];

  if (challenge === null) {
    return <Loading />;
  }

  const extraInfo: ExtraOverviewInfo[] = [
    {
      label: 'Deepest delve',
      value: challenge.mokhaiotlStats.delve,
      icon: 'fas fa-arrow-down',
    },
  ];

  if (challenge.stage === Stage.MOKHAIOTL_DELVE_8PLUS) {
    extraInfo.push({
      label: 'Delves 1-8',
      icon: 'fas fa-hourglass-half',
      value: ticksToFormattedSeconds(
        challenge.splits[SplitType.MOKHAIOTL_CHALLENGE] ?? 0,
      ),
    });
  }

  return (
    <div className={styles.mokhaiotl}>
      <ChallengeOverview
        type={challenge.type}
        stage={challenge.stage}
        status={challenge.status}
        mode={challenge.mode}
        challengeTicks={challenge.challengeTicks}
        deaths={challenge.totalDeaths}
        party={challenge.party.map((player) => ({
          ...player,
          stageDeaths:
            challenge.status === ChallengeStatus.WIPED ? [challenge.stage] : [],
        }))}
        startTime={challenge.startTime}
        extraInfo={extraInfo}
      />
      <DelvesOverview challenge={challenge} />
    </div>
  );
}
