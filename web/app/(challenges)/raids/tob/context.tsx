'use client';

import { TobRaid } from '@blert/common';
import { ChallengeContext } from '@/challenge-context';
import Loading from '@/components/loading';
import { notFound, usePathname } from 'next/navigation';
import {
  Dispatch,
  SetStateAction,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export type RoomActorState = {
  selectedPlayer: string | null;
  setSelectedPlayer: Dispatch<SetStateAction<string | null>>;
  selectedRoomNpc: number | null;
  setSelectedRoomNpc: Dispatch<SetStateAction<number | null>>;
};

const missingPlayerDispatch: Dispatch<SetStateAction<string | null>> = () => {
  throw new Error('setSelectedPlayer must be used within an ActorContext');
};

const missingRoomNpcDispatch: Dispatch<SetStateAction<number | null>> = () => {
  throw new Error('setSelectedRoomNpc must be used within an ActorContext');
};

export const ActorContext = createContext<RoomActorState>({
  selectedPlayer: null,
  setSelectedPlayer: missingPlayerDispatch,
  selectedRoomNpc: null,
  setSelectedRoomNpc: missingRoomNpcDispatch,
});

export function TobContextProvider({
  children,
  raidId,
}: {
  children: React.ReactNode;
  raidId: string;
}) {
  const pathname = usePathname();

  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [selectedRoomNpc, setSelectedRoomNpc] = useState<number | null>(null);
  const raidIdRef = useRef(raidId);

  const [raid, setRaid] = useContext(ChallengeContext) as [
    TobRaid | null,
    Dispatch<SetStateAction<TobRaid | null>>,
  ];

  const [loading, setLoading] = useState(true);

  const raidLoaded = raid !== null;

  useEffect(() => {
    const getRaid = async () => {
      setLoading(!raidLoaded || raidIdRef.current !== raidId);

      try {
        const response = await fetch(`/api/v1/raids/tob/${raidId}`);
        if (response.status === 404) {
          setRaid(null);
          return;
        }
        const raidResponse = (await response.json()) as TobRaid;
        setRaid(raidResponse);
      } catch {
        setRaid(null);
      }

      setLoading(false);
      raidIdRef.current = raidId;
    };

    void getRaid();

    // Reload raid every time the page changes to support in-progress raids.
  }, [raidLoaded, raidId, pathname, setRaid]);

  useEffect(() => {
    // Clean up the raid when the component is unmounted.
    return () => setRaid(null);
  }, [setRaid]);

  if (loading) {
    return <Loading />;
  }

  if (raid === null) {
    return notFound();
  }

  return (
    <ActorContext.Provider
      value={{
        selectedPlayer,
        setSelectedPlayer,
        selectedRoomNpc,
        setSelectedRoomNpc,
      }}
    >
      {children}
    </ActorContext.Provider>
  );
}
