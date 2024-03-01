'use client';

import { Mode, Raid, RaidStatus } from '@blert/common';
import { useEffect, useState } from 'react';

import { loadRaid } from '../../../actions/raid';

import styles from './style.module.scss';
import { RaidContext } from '../context';

type RaidParams = {
  id: string;
};

type RaidLayoutProps = {
  params: RaidParams;
  children: React.ReactNode;
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
