'use client';

import { ChallengeType, MokhaiotlChallenge } from '@blert/common';
import { ReactNode } from 'react';

import { createChallengeContextProvider } from '../../challenge-context-provider';

const { ActorContext, ChallengeProvider } =
  createChallengeContextProvider<MokhaiotlChallenge>({
    buildUrl: (id) => `/api/v1/challenges/mokhaiotl/${id}`,
    challengeType: ChallengeType.MOKHAIOTL,
  });

export { ActorContext };

export function MokhaiotlContextProvider({
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
