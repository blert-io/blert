'use client';

import { ChallengeType, ColosseumChallenge } from '@blert/common';
import { ReactNode } from 'react';

import { createChallengeContextProvider } from '../../challenge-context-provider';

const { ActorContext, ChallengeProvider } =
  createChallengeContextProvider<ColosseumChallenge>({
    buildUrl: (id) => `/api/v1/challenges/colosseum/${id}`,
    challengeType: ChallengeType.COLOSSEUM,
  });

export { ActorContext };

export function ColosseumContextProvider({
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
