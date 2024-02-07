'use client';

import { useContext } from 'react';
import { RaidContext } from '../../context';
import { RaidBossesOverview } from '../../../components/raid-bosses-overview/raid-bosses-overview';
import { RaidLogo } from '../../../components/raid-logo/raid-logo-details';
import { RaidQuickDetails } from '../../../components/raid-quick-details/raid-quick-details';
import {
  RaidTeamPanel,
  PrimaryMeleeGear,
} from '../../../components/raid-team/raid-team';
import styles from './style.module.scss';

export default function Overview() {
  const raid = useContext(RaidContext);

  console.log(raid);

  return (
    <div className={styles.raid__Overview}>
      <RaidLogo />
      <RaidQuickDetails />
      <RaidTeamPanel
        players={[
          {
            name: 'Sacolyn',
            primaryMeleeGear: PrimaryMeleeGear.EliteVoid,
          },
          {
            name: '1Ogp',
            primaryMeleeGear: PrimaryMeleeGear.Blorva,
          },
          {
            name: '715',
            primaryMeleeGear: PrimaryMeleeGear.Blorva,
          },
          {
            name: 'NACHOCUPOFT',
            primaryMeleeGear: PrimaryMeleeGear.Blorva,
          },
          {
            name: 'Verzik Melee',
            primaryMeleeGear: PrimaryMeleeGear.Blorva,
          },
        ]}
      />
      <RaidBossesOverview />
    </div>
  );
}
