'use client';

import { useContext } from 'react';

import { RaidContext } from '../../context';
import { RaidBossesOverview } from '../../../../components/raid-bosses-overview/raid-bosses-overview';
import { RaidLogo } from '../../../../components/raid-logo/raid-logo-details';
import { RaidQuickDetails } from '../../../../components/raid-quick-details/raid-quick-details';
import { RaidTeamPanel } from '../../../../components/raid-team/raid-team';

import styles from './style.module.scss';

export default function Overview() {
  const raid = useContext(RaidContext);

  if (raid === null || raid === undefined) {
    return <div>Loading...</div>;
  }

  const playersWithGear = raid.party.map((player, i) => {
    return {
      name: player,
      primaryMeleeGear: raid.partyInfo[i].gear,
    };
  });

  return (
    <div className={styles.raid__Overview}>
      <RaidLogo />
      <RaidQuickDetails
        raidStatus={raid.status}
        raidDifficulty={raid.mode}
        totalRaidTicks={raid.totalRoomTicks}
        deaths={raid.totalDeaths}
        partySize={raid.party.length}
        startTime={raid.startTime}
      />
      <RaidTeamPanel players={playersWithGear} />
      <RaidBossesOverview rooms={raid.rooms} raidId={raid._id} />
    </div>
  );
}
