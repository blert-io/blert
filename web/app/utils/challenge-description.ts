import {
  Challenge,
  ChallengeStatus,
  challengeName,
  stageName,
} from '@blert/common';

export function partyNames(challenge: Challenge): string {
  const partyNames = challenge.party.map((p) => p.username);
  if (partyNames.length === 1) {
    return partyNames[0];
  }
  if (partyNames.length === 2) {
    return partyNames.join(' and ');
  }
  return (
    partyNames.slice(0, partyNames.length - 1).join(', ') +
    ', and ' +
    partyNames[challenge.party.length - 1]
  );
}

export function challengePageDescription(challenge: Challenge): string {
  const party = partyNames(challenge);

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
