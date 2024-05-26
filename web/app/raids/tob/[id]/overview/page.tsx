'use client';

import { TobRaid } from '@blert/common';
import { useContext } from 'react';

import { DisplayContext } from '@/display';
import { ChallengeContext } from '@/challenge-context';
import { RaidBossesOverview } from '@/components/raid-bosses-overview/raid-bosses-overview';
import { RaidQuickDetails } from '@/components/raid-quick-details/raid-quick-details';
import { RaidTeamPanel } from '@/components/raid-team/raid-team';
import PvMContentLogo, { PvMContent } from '@/components/pvm-content-logo';
import Loading from '@/components/loading';

import styles from './style.module.scss';

export default function Overview() {
  const [raid] = useContext(ChallengeContext) as [TobRaid | null, unknown];
  const display = useContext(DisplayContext);

  if (raid === null) {
    return <Loading />;
  }

  return (
    <div className={styles.raid__Overview}>
      <PvMContentLogo
        pvmContent={PvMContent.TheatreOfBlood}
        height={200}
        width={380}
      />
      <RaidQuickDetails
        type={raid.type}
        stage={raid.stage}
        status={raid.status}
        mode={raid.mode}
        totalRaidTicks={raid.challengeTicks}
        deaths={raid.totalDeaths}
        partySize={raid.party.length}
        startTime={raid.startTime}
      />
      <RaidTeamPanel players={raid.party} compactView={display.isCompact()} />
      <RaidBossesOverview
        rooms={raid.tobRooms}
        raidId={raid.uuid}
        splits={raid.splits}
      />
    </div>
  );
}
