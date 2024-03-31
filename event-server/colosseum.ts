import {
  ChallengeMode,
  ChallengeType,
  RaidDocument,
  Stage,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import { Challenge } from './challenge';
import { protoToEvent } from './proto';

export default class ColosseumChallenge extends Challenge {
  constructor(id: string, party: string[], startTime: number) {
    super(
      ChallengeType.COLOSSEUM,
      id,
      ChallengeMode.NO_MODE,
      party,
      startTime,
      Stage.COLOSSEUM_WAVE_1,
    );
  }

  protected async onInitialize(document: RaidDocument): Promise<void> {}

  protected async onFinish(): Promise<void> {
    console.log(`Colosseum challenge ${this.getId()} finished`);
  }

  protected async processChallengeEvent(event: Event): Promise<void> {
    if (event.getType() === Event.Type.PLAYER_UPDATE) {
      return;
    }
    // console.log('Colosseum event', protoToEvent(event));
  }
}
