'use client';

import { ChallengeMode, Stage, TobRaid } from '@blert/common';
import Link from 'next/link';
import { useContext } from 'react';

import { ChallengeContext } from '@/challenge-context';
import ChallengeOverview from '@/components/challenge-overview';
import Loading from '@/components/loading';
import { TOB_ROOMS } from '@/tools/split-calc/types';

import { RaidBossesOverview } from './raid-bosses-overview';

import styles from './style.module.scss';

const MODE_IDS: Record<number, string> = {
  [ChallengeMode.TOB_REGULAR]: 'reg',
  [ChallengeMode.TOB_HARD]: 'hm',
};

function splitCalcUrl(raid: TobRaid): string {
  const params = new URLSearchParams();
  params.set('mode', MODE_IDS[raid.mode] ?? 'reg');
  params.set('scale', raid.scale.toString());
  for (const room of TOB_ROOMS) {
    const ticks = raid.splits[room.splitType];
    if (ticks !== undefined && ticks > 0) {
      params.set(room.key, ticks.toString());
    }
  }
  return `/tools/split-calc?${params}`;
}

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
      />

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Boss Encounters</h2>
          <Link href={splitCalcUrl(raid)} className={styles.analyzeSplitsLink}>
            <i className="fas fa-calculator" /> Analyze Splits
          </Link>
        </div>
        <RaidBossesOverview
          rooms={raid.tobRooms}
          raidId={raid.uuid}
          splits={raid.splits}
        />
      </section>
    </div>
  );
}
