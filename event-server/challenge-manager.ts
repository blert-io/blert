import { ChallengeMode, ChallengeType } from '@blert/common';
import { v4 as uuidv4 } from 'uuid';

import { Challenge, challengePartyKey } from './challenge';
import Client from './client';
import TheatreChallenge from './theatre';
import ColosseumChallenge from './colosseum';

export default class ChallengeManager {
  private challengesById: { [id: string]: Challenge };
  private challengesByPartyKey: { [key: string]: Challenge };

  constructor() {
    this.challengesById = {};
    this.challengesByPartyKey = {};
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
    spectator: boolean,
  ): Promise<string> {
    const partyKey = challengePartyKey(type, partyMembers);

    let challenge = this.challengesByPartyKey[partyKey];

    if (challenge === undefined) {
      const challengeId = uuidv4();
      challenge = this.constructChallengeType(
        type,
        challengeId,
        mode,
        partyMembers,
      );

      this.challengesById[challengeId] = challenge;
      this.challengesByPartyKey[partyKey] = challenge;

      console.log(`${client} starting new raid ${challengeId}`);
      await challenge.initialize();
    } else {
      if (mode !== ChallengeMode.NO_MODE) {
        challenge.setMode(mode);
      }
      console.log(`${client} joining existing raid ${challenge.getId()}`);
    }

    await challenge.registerClient(client, spectator);

    return challenge.getId();
  }

  /**
   * Ends the participation of a client in a challenge. If the client is the
   * last remaining client streaming data for the challenge, it is considered
   * complete.
   *
   * @param client The client leaving the challenge.
   * @param id ID of the challenge the client is leaving.
   */
  public async leaveChallenge(client: Client, id: string): Promise<void> {
    const challenge = this.challengesById[id];
    if (challenge === undefined) {
      return;
    }

    challenge.removeClient(client);
    if (challenge.hasClients()) {
      return;
    }

    await this.endChallenge(challenge);
  }

  /**
   * Looks up an active raid session by its ID.
   * @param id ID of the raid.
   * @returns The raid if found.
   */
  public get(id: string): Challenge | undefined {
    return this.challengesById[id];
  }

  private async endChallenge(challenge: Challenge): Promise<void> {
    await challenge.finish();

    delete this.challengesById[challenge.getId()];
    delete this.challengesByPartyKey[challenge.getPartyKey()];

    console.log(`Ended raid ${challenge.getId()}`);
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
        return new TheatreChallenge(id, party, mode, startTime);

      case ChallengeType.COLOSSEUM:
        return new ColosseumChallenge(id, party, startTime);

      default:
        throw new Error(`Unimplemented challenge type: ${type}`);
    }
  }
}
