'use client';

import { Stage, TfaRaid } from '@blert/common';
import { useContext } from 'react';

import { ChallengeContext } from '@/challenge-context';
import Card from '@/components/card';
import ChallengeOverview from '@/components/challenge-overview';
import Loading from '@/components/loading';

import { BossRoute } from './boss-route';

import styles from './style.module.scss';

export default function Overview() {
  const [raid] = useContext(ChallengeContext) as [TfaRaid | null, unknown];

  if (raid === null) {
    return <Loading />;
  }

  const deathsByStage = Array.from(
    { length: raid.party.length },
    () => [] as Stage[],
  );
  for (const boss of raid.tfa.bosses) {
    for (const death of boss.deaths) {
      const playerIndex = raid.party.findIndex(
        (p) => p.currentUsername === death,
      );
      if (playerIndex !== -1) {
        deathsByStage[playerIndex].push(boss.stage);
      }
    }
  }

  return (
    <div className={styles.overview}>
      <ChallengeOverview
        type={raid.type}
        stage={raid.stage}
        status={raid.status}
        mode={raid.mode}
        challengeTicks={raid.challengeTicks}
        deaths={raid.totalDeaths}
        party={raid.party.map((player, index) => ({
          ...player,
          stageDeaths: deathsByStage[index],
        }))}
        startTime={raid.startTime}
        sessionUuid={raid.sessionUuid}
      />

      <Card fixed header={{ title: 'Boss Encounters' }}>
        <BossRoute raid={raid} />
      </Card>
    </div>
  );
}
