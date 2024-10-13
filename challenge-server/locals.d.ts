import { DataRepository } from '@blert/common';
import 'express';

import ChallengeManager from './challenge-manager';

declare global {
  namespace Express {
    interface Locals {
      challengeDataRepository: DataRepository;
      challengeManager: ChallengeManager;
      testDataRepository: DataRepository;
    }
  }
}
