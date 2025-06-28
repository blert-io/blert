import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  Stage,
} from '../challenge';
import { SplitType } from '../split';

export type ChallengeRow = {
  id: number;
  uuid: string;
  type: ChallengeType;
  status: ChallengeStatus;
  mode: ChallengeMode;
  stage: Stage;
  scale: number;
  start_time: Date;
  finish_time: Date | null;
  challenge_ticks: number;
  overall_ticks: number;
  total_deaths: number;
  full_recording: boolean;
  session_id: number;
};

export type ChallengeSplitRow = {
  id: number;
  challenge_id: number;
  type: SplitType;
  scale: number;
  ticks: number;
  accurate: boolean;
};
