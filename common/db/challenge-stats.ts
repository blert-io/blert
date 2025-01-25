import { TobChallengeStats } from '../challenge';
import { CamelToSnakeCase } from '../translate';

export type TobChallengeStatsRow = CamelToSnakeCase<TobChallengeStats> & {
  challenge_id: number;
};
