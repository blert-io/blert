'use client';

import { Raid } from '@blert/common';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { loadRaid } from '../../../actions/raid';
import { ActorContext, RaidContext } from '../context';

import styles from './style.module.scss';

type RaidParams = {
  id: string;
};

type RaidLayoutProps = {
  params: RaidParams;
  children: React.ReactNode;
};

export default function RaidLayout(props: RaidLayoutProps) {
  const id = props.params.id;
  const pathname = usePathname();

  const [raid, setRaid] = useState<Raid | null>(null);
  const [error, setError] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [selectedRoomNpc, setSelectedRoomNpc] = useState<number | null>(null);

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

    // Reload raid every time the page changes to support in-progress raids.
  }, [id, pathname]);

  return (
    <div className={styles.raid}>
      <RaidContext.Provider value={raid}>
        <ActorContext.Provider
          value={{
            selectedPlayer,
            setSelectedPlayer,
            selectedRoomNpc,
            setSelectedRoomNpc,
          }}
        >
          <div className={styles.content}>{props.children}</div>
        </ActorContext.Provider>
      </RaidContext.Provider>
    </div>
  );
}
