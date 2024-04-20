'use client';

import { ColosseumChallenge } from '@blert/common';
import { usePathname } from 'next/navigation';
import { useContext, useEffect, useState } from 'react';

import { ChallengeContext } from '@/challenge-context';
import { raidStatusNameAndColor } from '@/components/raid-quick-details/raid-quick-details';
import Loading from '@/components/loading';
import { ActorContext } from '../context';

import styles from './style.module.scss';

type ColosseumParams = {
  id: string;
};

type ColosseumLayoutProps = {
  params: ColosseumParams;
  children: React.ReactNode;
};

export default function ColosseumLayout(props: ColosseumLayoutProps) {
  const id = props.params.id;
  const pathname = usePathname();

  const [challenge, setChallenge] = useContext(ChallengeContext);
  const [loading, setLoading] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [selectedRoomNpc, setSelectedRoomNpc] = useState<number | null>(null);

  useEffect(() => {
    const getRaid = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/v1/challenges/colosseum/${id}`);
        if (response.status === 404) {
          setChallenge(null);
        }
        setChallenge(await response.json());
      } catch (e) {
        setChallenge(null);
      }
      setLoading(false);
    };

    getRaid();

    // Reload raid every time the page changes to support in-progress raids.
  }, [id, pathname, setChallenge]);

  useEffect(() => {
    // Cleanup the challenge when the component is unmounted.
    return () => setChallenge(null);
  });

  useEffect(() => {
    if (challenge !== null) {
      const [status] = raidStatusNameAndColor(
        challenge.status,
        challenge.stage,
      );
      document.title = `Colosseum ${status} | Blert`;
    } else {
      document.title = `Colosseum | Blert`;
    }
  }, [challenge]);

  if (loading) {
    return <Loading />;
  }

  if (challenge === null) {
    return <div>Colosseum challenge not found</div>;
  }

  return (
    <div className={styles.layout}>
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
