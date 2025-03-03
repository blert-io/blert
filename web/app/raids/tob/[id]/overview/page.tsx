'use client';

import { Stage, TobRaid } from '@blert/common';
import { useContext } from 'react';

import { ChallengeContext } from '@/challenge-context';
import ChallengeOverview from '@/components/challenge-overview';
import { PvMContent } from '@/components/pvm-content-logo';
import Loading from '@/components/loading';

import { RaidBossesOverview } from './raid-bosses-overview';

import styles from './style.module.scss';

export default function Overview() {
  const [raid] = useContext(ChallengeContext) as [TobRaid | null, unknown];

  if (raid === null) {
    return <Loading />;
  }

  const deathsByStage = Array.from(
    { length: raid.party.length },
    () => [] as Stage[],
  );
  Object.values(raid.tobRooms).forEach((room) => {
    for (const death of room?.deaths ?? []) {
      const playerIndex = raid.party.findIndex(
        (p) => p.currentUsername === death,
      );
      if (playerIndex !== -1) {
        deathsByStage[playerIndex].push(room!.stage);
      }
    }
  });

  return (
    <div className={styles.raid__Overview}>
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
        pvmContent={PvMContent.TheatreOfBlood}
      />

      <section className={styles.section}>
        <h2>Boss Encounters</h2>
        <RaidBossesOverview
          rooms={raid.tobRooms}
          raidId={raid.uuid}
          splits={raid.splits}
        />
      </section>
    </div>
  );
}
