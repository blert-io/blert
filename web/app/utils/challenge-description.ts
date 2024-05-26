import {
  Challenge,
  ChallengeStatus,
  challengeName,
  stageName,
} from '@blert/common';

export function challengePageDescription(challenge: Challenge): string {
  const partyNames = challenge.party.map((p) => p.username);
  let party;
  if (partyNames.length === 1) {
    party = partyNames[0];
  } else if (partyNames.length === 2) {
    party = partyNames.join(' and ');
  } else {
    party =
      partyNames.slice(0, partyNames.length - 1).join(', ') +
      ', and ' +
      partyNames[challenge.party.length - 1];
  }

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
