import {
  Challenge,
  ChallengeStatus,
  challengeName,
  stageName,
} from '@blert/common';

import { oxford } from './copy';

export function challengePartyNames(
  challenge: Pick<Challenge, 'party'>,
): string {
  return oxford(challenge.party.map((p) => p.username));
}

export function challengePageDescription(
  challenge: Pick<Challenge, 'party' | 'status' | 'stage' | 'type'>,
): string {
  const party = challengePartyNames(challenge);
  const stage = stageName(challenge.stage);
  const target =
    `the ${challengeName(challenge.type)} ` +
    `on Blert, Old School RuneScape's premier PvM tracker.`;

  switch (challenge.status) {
    case ChallengeStatus.IN_PROGRESS:
      return `Follow ${party}'s progress in ${target}`;
    case ChallengeStatus.COMPLETED:
      return `Review ${party}'s completion of ${target}`;
    case ChallengeStatus.RESET:
      return `Review ${party}'s reset at ${stage} in ${target}`;
    case ChallengeStatus.WIPED:
      return `Review ${party}'s wipe at ${stage} in ${target}`;
    case ChallengeStatus.ABANDONED:
      return `Review ${party}'s abandoned attempt at ${stage} in ${target}`;
  }

  const _exhaustive: never = challenge.status;
  return `Review ${party}'s attempt at ${stage} in ${target}`;
}
