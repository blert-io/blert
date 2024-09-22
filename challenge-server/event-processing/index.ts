import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  DataRepository,
  Stage,
  StageStatus,
} from '@blert/common';

import ChallengeProcessor, { InitializedFields } from './challenge-processor';
import ColosseumProcessor from './colosseum';
import sql from '../db';
import TheatreProcessor from './theatre';

export { ChallengeProcessor };

export function newChallengeProcessor(
  dataRepository: DataRepository,
  uuid: string,
  type: ChallengeType,
  mode: ChallengeMode,
  stage: Stage,
  stageStatus: StageStatus,
  party: string[],
  extraFields: InitializedFields = {},
): ChallengeProcessor {
  switch (type) {
    case ChallengeType.COLOSSEUM:
      return new ColosseumProcessor(
        dataRepository,
        uuid,
        mode,
        stage,
        stageStatus,
        party,
        extraFields,
      );
    case ChallengeType.TOB:
      return new TheatreProcessor(
        dataRepository,
        uuid,
        mode,
        stage,
        stageStatus,
        party,
        extraFields,
      );

    case ChallengeType.COX:
    case ChallengeType.INFERNO:
    case ChallengeType.TOA:
      throw new Error(`Unimplemented challenge type ${type}`);

    default:
      throw new Error(`Unknown challenge type ${type}`);
  }
}

export async function loadChallengeProcessor(
  dataRepository: DataRepository,
  uuid: string,
  challengeStatus: ChallengeStatus = ChallengeStatus.IN_PROGRESS,
  stageStatus: StageStatus = StageStatus.ENTERED,
): Promise<ChallengeProcessor | null> {
  const [challenge] = await sql`SELECT * FROM challenges WHERE uuid = ${uuid}`;
  if (!challenge) {
    return null;
  }

  const players = await sql`
      SELECT player_id, username
      FROM challenge_players
      WHERE challenge_id = ${challenge.id}
      ORDER BY orb ASC
    `;

  const party = players.map((player) => player.username);
  return newChallengeProcessor(
    dataRepository,
    challenge.uuid,
    challenge.type,
    challenge.mode,
    challenge.stage,
    stageStatus,
    party,
    {
      databaseId: challenge.id,
      challengeStatus,
      playerIds: players.map((player) => player.player_id),
      totalChallengeTicks: challenge.challenge_ticks,
    },
  );
}
