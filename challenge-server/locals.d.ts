import { DataRepository } from '@blert/common';
import 'express';

import ChallengeStore from './challenge-store';

declare global {
  namespace Express {
    interface Locals {
      challengeDataRepository: DataRepository;
      challengeStore: ChallengeStore;
      testDataRepository: DataRepository;
    }
  }
}
