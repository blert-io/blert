import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  ClientStatus,
  RecordingType,
  Stage,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import { StageUpdate } from './challenge';
import Client from './client';

export type RecordedTimes = {
  challenge: number;
  overall: number;
};

export type ChallengeUpdate = {
  mode: ChallengeMode;
  stage?: StageUpdate;
};

export type ChallengeInfo = {
  type: ChallengeType;
  mode: ChallengeMode;
  status: ChallengeStatus;
  stage: Stage;
  party: string[];
};

export default abstract class ChallengeManager {
  /**
   * Attempts to start a new challenge session with the given party members, or
   * or joins an existing session for the party.
   *
   * @param client The client initiating the challenge.
   * @param challengeType The type of challenge the client is entering.
   * @param mode The reported mode of the challenge.
   * @param party List of players in the challenge party.
   * @param stage The stage at which the challenge is starting.
   * @param recordingType Whether the client is a participant or spectator.
   * @returns UUID of the challenge recording.
   */
  public abstract startOrJoin(
    client: Client,
    challengeType: ChallengeType,
    mode: ChallengeMode,
    party: string[],
    stage: Stage,
    recordingType: RecordingType,
  ): Promise<string>;

  /**
   * Indicates that a client has completed and left a challenge.
   * @param client The client that is leaving.
   * @param challengeId The ID of the challenge.
   * @param times The client's recorded overall challenge times.
   */
  public abstract completeChallenge(
    client: Client,
    challengeId: string,
    times: RecordedTimes | null,
  ): Promise<void>;

  /**
   * Updates the state of a challenge.
   * @param client The client making the update.
   * @param challengeId The ID of the challenge.
   * @param update New state of the challenge reported by the client.
   */
  public abstract updateChallenge(
    client: Client,
    challengeId: string,
    update: ChallengeUpdate,
  ): Promise<void>;

  /**
   * Returns information about an active challenge.
   * @param challengeId The ID of the challenge.
   * @returns Information about the challenge, or null if the challenge
   *   is not found.
   */
  public abstract getChallengeInfo(
    challengeId: string,
  ): Promise<ChallengeInfo | null>;

  /**
   * Handles a batch of challenge events from a client.
   * @param client The client that sent the events.
   * @param challengeId The ID of the challenge.
   * @param events The events to process.
   */
  public abstract processEvents(
    client: Client,
    challengeId: string,
    events: Event[],
  ): Promise<void>;

  /**
   * Adds a client to an existing challenge.
   * @param client The client to add.
   * @param challengeId ID of the challenge.
   * @param recordingType Whether the client is a participant or spectator.
   * @returns True if the client was added, false if the challenge is not found.
   */
  public abstract addClient(
    client: Client,
    challengeId: string,
    recordingType: RecordingType,
  ): boolean;

  /**
   * Changes the connection status of a client.
   * @param client The client.
   * @param status The new status of the client.
   */
  public abstract updateClientStatus(
    client: Client,
    status: ClientStatus,
  ): void;
}
