'use client';

import { usePathname } from 'next/navigation';
import { useContext, useEffect, useState } from 'react';

import { ChallengeContext } from '@/challenge-context';
import Loading from '@/components/loading';
import { raidStatusNameAndColor } from '@/components/raid-quick-details/raid-quick-details';
import { ActorContext } from '../context';

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

  const [raid, setRaid] = useContext(ChallengeContext);

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
  }, [id, pathname, setRaid]);

  useEffect(() => {
    // Clean up the raid when the component is unmounted.
    return () => setRaid(null);
  }, [setRaid]);

  useEffect(() => {
    if (raid !== null) {
      const [status] = raidStatusNameAndColor(raid.status, raid.stage);
      document.title = `ToB ${status} | Blert`;
    } else {
      document.title = `Theatre of Blood | Blert`;
    }
  }, [raid]);

  if (loading) {
    return <Loading />;
  }

  if (raid === null) {
    return <div>Raid not found</div>;
  }

  return (
    <div className={styles.raid}>
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
    </div>
  );
}
