import { DataRepository } from '@blert/common';
import 'express';

import ChallengeManager from './challenge-manager';
import { MergeService } from './merge-service';

declare global {
  namespace Express {
    interface Locals {
      challengeDataRepository: DataRepository;
      challengeManager: ChallengeManager;
      mergeService: MergeService;
      testDataRepository: DataRepository;
    }
  }
}
