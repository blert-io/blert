import { ChallengeStatus, Raid, challengeName, stageName } from '@blert/common';

export function challengePageDescription(challenge: Raid): string {
  let party;
  if (challenge.party.length === 1) {
    party = challenge.party[0];
  } else if (challenge.party.length === 2) {
    party = challenge.party.join(' and ');
  } else {
    party =
      challenge.party.slice(0, challenge.party.length - 1).join(', ') +
      ', and ' +
      challenge.party[challenge.party.length - 1];
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
