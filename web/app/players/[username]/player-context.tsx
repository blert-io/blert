'use client';

import { createContext, useContext } from 'react';

import type { PersonalBest, PlayerWithStats } from '@/actions/challenge';

type PlayerContextType = PlayerWithStats & {
  personalBests: PersonalBest[];
};

const PlayerContext = createContext<PlayerContextType | null>(null);

export function PlayerProvider({
  children,
  player,
}: {
  children: React.ReactNode;
  player: PlayerContextType;
}) {
  return (
    <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (context === null) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
}
