'use client';

import { Raid } from '@blert/common';
import { Dispatch, SetStateAction, createContext, useState } from 'react';

type ChallengeState = [Raid | null, Dispatch<SetStateAction<Raid | null>>];
export const ChallengeContext = createContext<ChallengeState>([null, () => {}]);

export default function ChallengeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const challengeState = useState<Raid | null>(null);
  return (
    <ChallengeContext.Provider value={challengeState}>
      {children}
    </ChallengeContext.Provider>
  );
}
