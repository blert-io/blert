'use client';

import { ChallengeContext } from '@/challenge-context';
import Loading from '@/components/loading';
import { usePathname } from 'next/navigation';
import {
  Dispatch,
  SetStateAction,
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';

export type RoomActorState = {
  selectedPlayer: string | null;
  setSelectedPlayer: Dispatch<SetStateAction<string | null>>;
  selectedRoomNpc: number | null;
  setSelectedRoomNpc: Dispatch<SetStateAction<number | null>>;
};

export const ActorContext = createContext<RoomActorState>({
  selectedPlayer: null,
  setSelectedPlayer: (player) => {},
  selectedRoomNpc: null,
  setSelectedRoomNpc: (npcId) => {},
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

  const [raid, setRaid] = useContext(ChallengeContext);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getRaid = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/v1/raids/tob/${raidId}`);
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
  }, [raidId, pathname, setRaid]);

  useEffect(() => {
    // Clean up the raid when the component is unmounted.
    return () => setRaid(null);
  }, [setRaid]);

  if (loading) {
    return <Loading />;
  }

  if (raid === null) {
    return <div>Raid not found</div>;
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
