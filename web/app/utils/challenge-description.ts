import {
  Challenge,
  ChallengeStatus,
  challengeName,
  stageName,
} from '@blert/common';

import { oxford } from './copy';

export function challengePartyNames(challenge: Challenge): string {
  return oxford(challenge.party.map((p) => p.username));
}

export function challengePageDescription(challenge: Challenge): string {
  const party = challengePartyNames(challenge);

  let stem;
  if (challenge.status === ChallengeStatus.IN_PROGRESS) {
    stem = `Follow ${party}'s progress in`;
  } else if (challenge.status === ChallengeStatus.COMPLETED) {
    stem = `Review ${party}'s completion of`;
  } else {
    const status =
      challenge.status === ChallengeStatus.RESET ? 'reset' : 'wipe';
    stem = `Review ${party}'s ${status} at ${stageName(challenge.stage)} in`;
  }

  return (
    `${stem} the ${challengeName(challenge.type)} ` +
    `on Blert, Old School RuneScape's premier PvM tracker.`
  );
}
