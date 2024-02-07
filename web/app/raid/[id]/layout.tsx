'use client';

import { Mode, Raid, RaidStatus } from '@blert/common';
import { useEffect, useState } from 'react';

import { loadRaid } from '../../actions/raid';

import styles from './style.module.scss';
import { RaidContext } from '../context';

type RaidParams = {
  id: string;
};

type RaidLayoutProps = {
  params: RaidParams;
  children: React.ReactNode;
};

const RAID_MODE_STRING = {
  [Mode.ENTRY]: 'Entry',
  [Mode.REGULAR]: 'Regular',
  [Mode.HARD]: 'Hard',
};

const RAID_STATUS_STRING = {
  [RaidStatus.IN_PROGRESS]: 'In Progress',
  [RaidStatus.COMPLETED]: 'Completed',
  [RaidStatus.MAIDEN_RESET]: 'Maiden Reset',
  [RaidStatus.MAIDEN_WIPE]: 'Maiden Wipe',
  [RaidStatus.BLOAT_RESET]: 'Bloat Reset',
  [RaidStatus.BLOAT_WIPE]: 'Bloat Wipe',
  [RaidStatus.NYLO_RESET]: 'Nylocas Reset',
  [RaidStatus.NYLO_WIPE]: 'Nylocas Wipe',
  [RaidStatus.SOTE_RESET]: 'Sotetseg Reset',
  [RaidStatus.SOTE_WIPE]: 'Sotetseg Wipe',
  [RaidStatus.XARPUS_RESET]: 'Xarpus Reset',
  [RaidStatus.XARPUS_WIPE]: 'Xarpus Wipe',
  [RaidStatus.VERZIK_WIPE]: 'Verzik Wipe',
};

export default function RaidLayout(props: RaidLayoutProps) {
  const id = props.params.id;

  const [raid, setRaid] = useState<Raid | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const getRaid = async () => {
      const raid = await loadRaid(id);
      if (raid) {
        setRaid(raid);
      } else {
        setError(true);
      }
    };

    getRaid();
  }, [id]);

  return (
    <div className={styles.raid}>
      <RaidContext.Provider value={raid}>
        <div className={styles.content}>{props.children}</div>
      </RaidContext.Provider>
    </div>
  );
}
