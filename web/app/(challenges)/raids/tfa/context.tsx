'use client';

import { ChallengeType, TfaRaid } from '@blert/common';
import { ReactNode } from 'react';

import { createChallengeContextProvider } from '../../challenge-context-provider';

const { ActorContext, ChallengeProvider } =
  createChallengeContextProvider<TfaRaid>({
    buildUrl: (id) => `/api/v1/raids/tfa/${id}`,
    challengeType: ChallengeType.TFA,
  });

export { ActorContext };

export function TfaContextProvider({
  children,
  raidId,
}: {
  children: ReactNode;
  raidId: string;
}) {
  return <ChallengeProvider challengeId={raidId}>{children}</ChallengeProvider>;
}
