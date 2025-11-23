'use client';

import { Challenge } from '@blert/common';
import { Dispatch, SetStateAction, createContext, useState } from 'react';

type ChallengeState = [
  Challenge | null,
  Dispatch<SetStateAction<Challenge | null>>,
];
export const ChallengeContext = createContext<ChallengeState>([
  null,
  () => {
    /* noop */
  },
]);

export default function ChallengeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const challengeState = useState<Challenge | null>(null);
  return (
    <ChallengeContext.Provider value={challengeState}>
      {children}
    </ChallengeContext.Provider>
  );
}
