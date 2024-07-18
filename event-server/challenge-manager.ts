import {
  ChallengeMode,
  ChallengeType,
  DataRepository,
  Stage,
} from '@blert/common';
import { v4 as uuidv4 } from 'uuid';

import { Challenge, challengePartyKey } from './challenge';
import Client from './client';
import ColosseumChallenge from './colosseum';
import TheatreChallenge from './theatre';
import { PlayerManager } from './players';

export default class ChallengeManager {
  private challengesById: Map<string, Challenge>;
  private challengesByPartyKey: Map<string, Challenge[]>;

  private playerManager: PlayerManager;
  private dataRepository: DataRepository;

  constructor(playerManager: PlayerManager, dataRepository: DataRepository) {
    this.challengesById = new Map();
    this.challengesByPartyKey = new Map();
    this.playerManager = playerManager;
    this.dataRepository = dataRepository;
  }

  /**
   * Attempts to start a new challenge session with the given party members, or
   * or joins an existing session for the party.
   *
   * @param client The client initiating the challenge.
   * @param partyMembers Ordered list of members in the challenge party.
   * @returns The ID of the challenge session.
   */
  public async startOrJoin(
    client: Client,
    type: ChallengeType,
    mode: ChallengeMode,
    partyMembers: string[],
    stage: Stage,
  ): Promise<Challenge> {
    const partyKey = challengePartyKey(type, partyMembers);

    let challenge = this.getLastChallengeForParty(partyKey);

    let startNewChallenge = challenge === undefined;

    const hasAlreadyCompleted =
      challenge?.playerHasCompleted(client.getLoggedInRsn()!) ?? false;
    if (hasAlreadyCompleted) {
      startNewChallenge = true;
      console.log(
        `${client} attempted to join challenge with party ${partyKey} ` +
          `but has already completed it; assuming a new challenge instead.`,
      );
    }

    if (
      challenge !== undefined &&
      stage !== Stage.UNKNOWN &&
      stage < challenge.getStage()
    ) {
      startNewChallenge = true;
      console.log(
        `${client} joined challenge with key ${partyKey} at stage ${stage} ` +
          `while the existing challenge is at stage ${challenge.getStage()}; ` +
          'assuming a new challenge instead.',
      );
    }

    if (startNewChallenge) {
      const challengeId = uuidv4();
      challenge = this.constructChallengeType(
        type,
        challengeId,
        mode,
        partyMembers,
      );

      partyMembers.forEach((member) =>
        this.playerManager.setPlayerActive(member, challengeId),
      );

      this.challengesById.set(challengeId, challenge);

      if (!this.challengesByPartyKey.has(partyKey)) {
        this.challengesByPartyKey.set(partyKey, []);
      }
      this.challengesByPartyKey.get(partyKey)!.push(challenge);

      console.log(`${client} starting new challenge ${challengeId}`);
      await challenge.initialize();
    } else {
      if (mode !== ChallengeMode.NO_MODE) {
        challenge!.setMode(mode);
      }
      console.log(`${client} joining existing challenge ${challenge!.getId()}`);
    }

    return challenge!;
  }

  /**
   * Looks up an active raid session by its ID.
   * @param id ID of the raid.
   * @returns The raid if found.
   */
  public get(id: string): Challenge | undefined {
    return this.challengesById.get(id);
  }

  public async endChallenge(challenge: Challenge): Promise<void> {
    await challenge.finish();
    this.cleanupChallenge(challenge);
    console.log(`Ended challenge ${challenge.getId()}`);
  }

  public async terminateChallenge(challenge: Challenge): Promise<void> {
    await challenge.terminate();
    this.cleanupChallenge(challenge);
    console.log(`Terminated challenge ${challenge.getId()}`);
  }

  private getLastChallengeForParty(partyKey: string): Challenge | undefined {
    const challenges = this.challengesByPartyKey.get(partyKey);
    return challenges?.[challenges.length - 1];
  }

  private constructChallengeType(
    type: ChallengeType,
    id: string,
    mode: ChallengeMode,
    party: string[],
  ): Challenge {
    const startTime = Date.now();

    switch (type) {
      case ChallengeType.TOB:
        return new TheatreChallenge(
          this.dataRepository,
          id,
          party,
          mode,
          startTime,
        );

      case ChallengeType.COLOSSEUM:
        return new ColosseumChallenge(
          this.dataRepository,
          id,
          party,
          startTime,
        );

      default:
        throw new Error(`Unimplemented challenge type: ${type}`);
    }
  }

  private cleanupChallenge(challenge: Challenge): void {
    this.challengesById.delete(challenge.getId());

    const byKey = this.challengesByPartyKey.get(challenge.getPartyKey())!;
    this.challengesByPartyKey.set(
      challenge.getPartyKey(),
      byKey.filter((c) => c !== challenge),
    );

    challenge
      .getParty()
      .forEach((member) =>
        this.playerManager.setPlayerInactive(member, challenge.getId()),
      );
  }
}
