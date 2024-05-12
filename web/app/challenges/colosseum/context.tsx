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

export function ColosseumContextProvider({
  children,
  challengeId,
}: {
  children: React.ReactNode;
  challengeId: string;
}) {
  const pathname = usePathname();

  const [challenge, setChallenge] = useContext(ChallengeContext);
  const [loading, setLoading] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [selectedRoomNpc, setSelectedRoomNpc] = useState<number | null>(null);

  useEffect(() => {
    const loadColosseum = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/v1/challenges/colosseum/${challengeId}`,
        );
        if (response.status === 404) {
          setChallenge(null);
        }
        setChallenge(await response.json());
      } catch (e) {
        setChallenge(null);
      }
      setLoading(false);
    };

    loadColosseum();

    // Reload raid every time the page changes to support in-progress raids.
  }, [challengeId, pathname, setChallenge]);

  useEffect(() => {
    // Cleanup the challenge when the component is unmounted.
    return () => setChallenge(null);
  }, [setChallenge]);

  if (loading) {
    return <Loading />;
  }

  if (challenge === null) {
    return <div>Colosseum run not found</div>;
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
