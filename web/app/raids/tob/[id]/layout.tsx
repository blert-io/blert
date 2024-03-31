'use client';

import { TobRaid } from '@blert/common';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ActorContext, RaidContext } from '../context';
import { raidStatusNameAndColor } from '../../../components/raid-quick-details/raid-quick-details';
import Loading from '../../../components/loading';

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

  const [raid, setRaid] = useState<TobRaid | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [selectedRoomNpc, setSelectedRoomNpc] = useState<number | null>(null);

  useEffect(() => {
    const getRaid = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/v1/raids/tob/${id}`);
        if (response.status === 404) {
          setRaid(null);
        }
        setRaid(await response.json());
      } catch (e) {
        setRaid(null);
      }
      setLoading(false);
    };

    getRaid();

    // Reload raid every time the page changes to support in-progress raids.
  }, [id, pathname]);

  useEffect(() => {
    if (raid !== null) {
      const [status] = raidStatusNameAndColor(raid.status, raid.stage);
      document.title = `ToB ${status} | Blert`;
    } else {
      document.title = `Theatre of Blood | Blert`;
    }

    return () => {
      document.title = 'Blert';
    };
  }, [raid]);

  if (loading) {
    return <Loading />;
  }

  if (raid === null) {
    return <div>Raid not found</div>;
  }

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
