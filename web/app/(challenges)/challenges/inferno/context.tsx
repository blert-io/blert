'use client';

import { ChallengeType, InfernoChallenge } from '@blert/common';
import { ReactNode } from 'react';

import { createChallengeContextProvider } from '../../challenge-context-provider';

const { ActorContext, ChallengeProvider } =
  createChallengeContextProvider<InfernoChallenge>({
    buildUrl: (id) => `/api/v1/challenges/inferno/${id}`,
    challengeType: ChallengeType.INFERNO,
  });

export { ActorContext };

export function InfernoContextProvider({
  children,
  challengeId,
}: {
  children: ReactNode;
  challengeId: string;
}) {
  return (
    <ChallengeProvider challengeId={challengeId}>{children}</ChallengeProvider>
  );
}
