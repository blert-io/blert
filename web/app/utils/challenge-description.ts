import {
  Challenge,
  ChallengeStatus,
  challengeName,
  stageName,
} from '@blert/common';

export function partyNames(party: string[]): string {
  if (party.length === 1) {
    return party[0];
  }
  if (party.length === 2) {
    return party.join(' and ');
  }
  return (
    party.slice(0, party.length - 1).join(', ') +
    ', and ' +
    party[party.length - 1]
  );
}

export function challengePartyNames(challenge: Challenge): string {
  return partyNames(challenge.party.map((p) => p.username));
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
