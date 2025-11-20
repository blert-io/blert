'use client';

import { ChallengeType, TobRaid } from '@blert/common';
import { ReactNode } from 'react';

import { createChallengeContextProvider } from '../../challenge-context-provider';

const { ActorContext, ChallengeProvider } =
  createChallengeContextProvider<TobRaid>({
    buildUrl: (id) => `/api/v1/raids/tob/${id}`,
    challengeType: ChallengeType.TOB,
  });

export { ActorContext };

export function TobContextProvider({
  children,
  raidId,
}: {
  children: ReactNode;
  raidId: string;
}) {
  return <ChallengeProvider challengeId={raidId}>{children}</ChallengeProvider>;
}
