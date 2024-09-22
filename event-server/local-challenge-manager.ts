import {
  ChallengeMode,
  ChallengeType,
  ClientStatus,
  DataRepository,
  RecordingType,
  Stage,
  StageStatus,
} from '@blert/common';
import {
  ChallengeMap,
  ChallengeModeMap,
  Event,
  StageMap,
} from '@blert/common/generated/event_pb';
import { ServerMessage } from '@blert/common/generated/server_message_pb';
import { v4 as uuidv4 } from 'uuid';

import { Challenge, challengePartyKey } from './challenge';
import ChallengeManager, {
  ChallengeInfo,
  ChallengeUpdate,
  RecordedTimes,
} from './challenge-manager';
import Client from './client';
import ColosseumChallenge from './colosseum';
import { PlayerManager } from './players';
import TheatreChallenge from './theatre';
import { Users } from './users';

type Proto<E> = E[keyof E];

export default class LocalChallengeManager extends ChallengeManager {
  private challengesById: Map<string, Challenge>;
  private challengesByPartyKey: Map<string, Challenge[]>;

  private playerManager: PlayerManager;
  private dataRepository: DataRepository;
  private clientDataRepository: DataRepository;
  private challengeAggregators: { [id: string]: ChallengeStreamAggregator };

  constructor(
    playerManager: PlayerManager,
    dataRepository: DataRepository,
    clientDataRepository: DataRepository,
  ) {
    super();
    this.challengesById = new Map();
    this.challengesByPartyKey = new Map();
    this.playerManager = playerManager;
    this.dataRepository = dataRepository;
    this.clientDataRepository = clientDataRepository;
    this.challengeAggregators = {};
  }

  public override async startOrJoin(
    client: Client,
    type: ChallengeType,
    mode: ChallengeMode,
    partyMembers: string[],
    stage: Stage,
    recordingType: RecordingType,
  ): Promise<string> {
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
      challenge = await this.startNewChallenge(
        client,
        type,
        mode,
        partyMembers,
        partyKey,
      );
    } else {
      if (mode !== ChallengeMode.NO_MODE) {
        challenge!.setMode(mode);
      }
      console.log(`${client} joining existing challenge ${challenge!.getId()}`);
    }

    const challengeId = challenge!.getId();

    this.challengeAggregators[challengeId].addClient(client, recordingType);

    await Users.addRecordedChallenge(
      client.getUserId(),
      challenge!.getDatabaseId(),
      recordingType,
    );

    return challengeId;
  }

  public override async completeChallenge(
    client: Client,
    challengeId: string,
    times: RecordedTimes | null,
  ): Promise<void> {
    const aggregator = this.challengeAggregators[challengeId];
    if (aggregator === undefined) {
      console.error(`No aggregator for challenge ${challengeId}`);
      return;
    }

    const isFinished = await aggregator.markCompletion(
      client,
      times?.challenge ?? 0,
      times?.overall ?? 0,
    );
    if (!isFinished) {
      // Set a short delay before removing the client to allow any other
      // clients' completion events to be processed.
      setTimeout(() => aggregator.removeClient(client), 1500);
    }
  }

  public override async updateChallenge(
    client: Client,
    challengeId: string,
    update: ChallengeUpdate,
  ): Promise<void> {
    const aggregator = this.challengeAggregators[challengeId];
    if (aggregator === undefined) {
      console.error(`No aggregator for challenge ${challengeId}`);
      return;
    }

    await aggregator.updateChallenge(client, update);
  }

  public override async getChallengeInfo(
    challengeId: string,
  ): Promise<ChallengeInfo | null> {
    const challenge = this.challengesById.get(challengeId);
    if (challenge === undefined) {
      return null;
    }

    return {
      type: challenge.getType(),
      mode: challenge.getMode(),
      status: challenge.getChallengeStatus(),
      stage: challenge.getStage(),
      party: challenge.getParty(),
    };
  }

  public override async processEvents(
    client: Client,
    challengeId: string,
    events: Event[],
  ): Promise<void> {
    if (challengeId !== client.getActiveChallenge()) {
      console.error(
        `${client} sent events for challenge ${challengeId}, but is not in it.`,
      );
      return;
    }

    const aggregator = this.challengeAggregators[challengeId];
    if (aggregator) {
      for (const event of events) {
        await aggregator.process(client, event);
      }
    } else {
      console.error(`No aggregator for challenge ${challengeId}`);
    }
  }

  public override addClient(
    client: Client,
    challengeId: string,
    recordingType: RecordingType,
  ): boolean {
    const aggregator = this.challengeAggregators[challengeId];
    if (aggregator === undefined) {
      console.error(`No aggregator for challenge ${challengeId}`);
      return false;
    }

    aggregator.addClient(client, recordingType);
    return true;
  }

  public override updateClientStatus(
    client: Client,
    status: ClientStatus,
  ): void {
    const challengeId = client.getActiveChallenge();
    if (challengeId === null) {
      return;
    }

    const aggregator = this.challengeAggregators[challengeId];
    if (aggregator === undefined) {
      console.error(
        `${client} claims to be in unknown challenge ${challengeId}`,
      );
      client.setActiveChallenge(null);
      return;
    }

    switch (status) {
      case ClientStatus.ACTIVE:
        aggregator.setClientActive(client);
        break;

      case ClientStatus.IDLE:
        aggregator.setClientInactive(client);
        break;

      case ClientStatus.DISCONNECTED:
        aggregator.removeClient(client);
        break;
    }
  }

  /**
   * Completes a challenge, finalizing its state.
   * @param challengeId The ID of the challenge to end.
   */
  public async endChallenge(challengeId: string): Promise<void> {
    const challenge = this.challengesById.get(challengeId);
    if (challenge) {
      await challenge.finish();
      this.cleanupChallenge(challenge);
      console.log(`Ended challenge ${challenge.getId()}`);
    }
  }

  /**
   * Forcefully terminates a challenge and deletes all associated data.
   * @param challenge
   */
  public async terminateChallenge(challenge: Challenge): Promise<void> {
    await challenge.terminate();
    this.cleanupChallenge(challenge);
    console.log(`Terminated challenge ${challenge.getId()}`);
  }

  private getLastChallengeForParty(partyKey: string): Challenge | undefined {
    const challenges = this.challengesByPartyKey.get(partyKey);
    return challenges?.[challenges.length - 1];
  }

  private async startNewChallenge(
    client: Client,
    type: ChallengeType,
    mode: ChallengeMode,
    party: string[],
    partyKey: string,
  ): Promise<Challenge> {
    const challengeId = uuidv4();
    const challenge = this.constructChallengeType(
      type,
      challengeId,
      mode,
      party,
    );

    party.forEach((member) =>
      this.playerManager.setPlayerActive(member, challengeId),
    );

    this.challengesById.set(challengeId, challenge);

    if (!this.challengesByPartyKey.has(partyKey)) {
      this.challengesByPartyKey.set(partyKey, []);
    }
    this.challengesByPartyKey.get(partyKey)!.push(challenge);

    console.log(`${client} starting new challenge ${challengeId}`);
    await challenge.initialize();

    if (!this.challengeAggregators[challengeId]) {
      // Collect data from all clients for a percentage of challenges for
      // testing purposes.
      const shouldSaveClientEventData =
        type === ChallengeType.TOB &&
        (Math.random() < 0.15 ||
          client.getLoggedInRsn()?.toLowerCase() === 'sacolyn');
      if (shouldSaveClientEventData) {
        console.log(
          `Selected challenge ${challengeId} for client data recording`,
        );
      }

      this.challengeAggregators[challengeId] = new ChallengeStreamAggregator(
        this,
        this.playerManager,
        challenge,
        this.clientDataRepository,
        shouldSaveClientEventData,
      );
    }

    return challenge;
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
    console.log(
      `LocalChallengeManager cleaning up challenge ${challenge.getId()}`,
    );

    delete this.challengeAggregators[challenge.getId()];
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

type ConnectedClient = {
  client: Client;
  type: RecordingType;
  active: boolean;
  primary: boolean;
  hasFinished: boolean;
  activeStage: Stage | null;
  sentEvents: Event[];
};

class ChallengeStreamAggregator {
  private challengeManager: LocalChallengeManager;
  private playerManager: PlayerManager;
  private challenge: Challenge;
  private clients: ConnectedClient[];

  private lastEventTimestamp: number;
  private reconnectionTimestamp: number | null;
  private watchdogTimer: NodeJS.Timeout;

  private clientDataRepository: DataRepository;
  private saveClientEventData: boolean;

  /** How long to wait before cleaning up a challenge with no clients. */
  private static readonly MAX_RECONNECTION_PERIOD = 1000 * 60 * 5;

  /**
   * How long to wait before attempting to clean up a challenge not
   * receiving events.
   */
  private static readonly MAX_INACTIVITY_PERIOD = 1000 * 60 * 15;

  public constructor(
    challengeManager: LocalChallengeManager,
    playerManager: PlayerManager,
    challenge: Challenge,
    clientDataRepository: DataRepository,
    saveClientEventData: boolean = false,
  ) {
    this.challengeManager = challengeManager;
    this.playerManager = playerManager;
    this.challenge = challenge;
    this.clients = [];

    this.watchdogTimer = setInterval(() => this.watchdog(), 1000 * 60);
    this.reconnectionTimestamp = null;
    this.lastEventTimestamp = Date.now();

    this.clientDataRepository = clientDataRepository;
    this.saveClientEventData = saveClientEventData;
  }

  public getChallenge(): Challenge {
    return this.challenge;
  }

  /**
   * Registers a client as an event stream for the challenge. If there is no
   * existing primary client, the new client will be marked as primary.
   *
   * The client cannot already be in a challenge.
   *
   * @param client The new client.
   */
  public addClient(client: Client, type: RecordingType): void {
    if (client.getActiveChallenge() === this.challenge.getId()) {
      return;
    }

    if (client.getActiveChallenge() !== null) {
      console.error(
        `${client} is already in challenge ${client.getActiveChallenge()}`,
      );
      return;
    }

    if (this.clients.find((c) => c.client === client)) {
      console.error(`${client} is already streaming to ${this}`);
      return;
    }

    client.setActiveChallenge(this.challenge.getId());

    const hasPrimaryClient = this.clients.some((c) => c.primary);

    this.clients.push({
      client,
      type,
      active: true,
      primary: !hasPrimaryClient,
      hasFinished: false,
      activeStage: null,
      sentEvents: [],
    });

    this.stopReconnectionTimer();
  }

  /**
   * Removes a client from the event stream. If the client was the primary
   * client, a new primary client will be selected from the remaining clients.
   *
   * If the challenge has no clients remaining, it will be cleaned up after a
   * short period.
   *
   * @param client The client to remove.
   */
  public removeClient(client: Client): void {
    const clientToRemove = this.clients.find((c) => c.client === client);
    if (!clientToRemove) {
      return;
    }

    client.setActiveChallenge(null);

    if (this.clients.length === 1) {
      this.clients = [];
      // Challenges without clients are kept alive for a short period to allow
      // for reconnection.
      this.startReconnectionTimer();
      return;
    }

    this.clients = this.clients.filter((c) => c.client !== client);

    if (clientToRemove.primary) {
      this.updatePrimaryClient();
    }
  }

  /**
   * Marks a registered client as active, allowing its events to be processed.
   *
   * @param client The active client.
   */
  public setClientActive(client: Client): void {
    const connectedClient = this.clients.find((c) => c.client === client);
    if (!connectedClient) {
      console.error(`setClientActive: ${client} is not connected to ${this}`);
      return;
    }

    connectedClient.active = true;

    const hasPrimaryClient = this.clients.some((c) => c.primary);
    if (!hasPrimaryClient) {
      this.updatePrimaryClient();
    }

    this.stopReconnectionTimer();
  }

  /**
   * Marks a registered client as inactive, preventing its events from being
   * processed.
   *
   * @param client The inactive client.
   */
  public setClientInactive(client: Client): void {
    const connectedClient = this.clients.find((c) => c.client === client);
    if (!connectedClient) {
      console.error(`setClientInactive: ${client} is not connected to ${this}`);
      return;
    }

    connectedClient.active = false;
    if (connectedClient.primary) {
      connectedClient.primary = false;
      this.updatePrimaryClient();
    }
  }

  /**
   * Handles an incoming challenge update.
   * @param client The client that sent the update.
   * @param update The update.
   */
  public async updateChallenge(
    client: Client,
    update: ChallengeUpdate,
  ): Promise<void> {
    const connectedClient = this.clients.find((c) => c.client === client);
    if (!connectedClient) {
      console.error(`updateChallenge: ${client} is not connected to ${this}`);
      return;
    }

    if (update.mode !== ChallengeMode.NO_MODE) {
      if (update.mode === ChallengeMode.TOB_ENTRY) {
        // TODO(frolv): At some point in the future, allow entry mode
        // raids to be recorded.
        console.log(`Terminating ToB entry mode raid ${this}`);
        await this.terminateAndPurgeChallenge();
        return;
      }

      await this.challenge.setMode(update.mode);
    }

    if (update.stage !== undefined) {
      const stageUpdate = update.stage;

      switch (stageUpdate.status) {
        case StageStatus.STARTED:
          connectedClient.activeStage = stageUpdate.stage;
          break;

        case StageStatus.COMPLETED:
        case StageStatus.WIPED:
          connectedClient.activeStage = null;
          connectedClient.sentEvents = [];
          break;
      }

      if (connectedClient.primary) {
        await this.challenge.updateStage(stageUpdate);
      }
    }
  }

  /**
   * Handles an incoming event from a registered client.
   *
   * @param client The client that sent the event.
   * @param event The event.
   */
  public async process(client: Client, event: Event): Promise<void> {
    const connectedClient = this.clients.find((c) => c.client === client);
    if (!connectedClient) {
      console.error(`process: ${client} is not connected to ${this}`);
      return;
    }

    this.lastEventTimestamp = Date.now();

    if (connectedClient.activeStage !== null) {
      connectedClient.sentEvents.push(event);
    }

    // TODO(frolv): For now, the primary client's event are used directly.
    // This should be updated to collect and merge events from all clients.
    if (connectedClient.primary) {
      await this.challenge.processEvent(event);
    }
  }

  /**
   * Indicates that a client has completed the challenge. Once all clients have
   * notified completion, the challenge will be finished and cleaned up.
   *
   * @param client The client that completed the challenge.
   * @param overallTicks The client's overall completion time in ticks.
   * @returns Whether the challenge is now complete.
   */
  public async markCompletion(
    client: Client,
    challengeTicks: number,
    overallTicks: number,
  ): Promise<boolean> {
    const connectedClient = this.clients.find((c) => c.client === client);
    if (!connectedClient) {
      console.error(`markCompletion: ${client} is not connected to ${this}`);
      return false;
    }
    if (connectedClient.hasFinished) {
      return this.isComplete();
    }

    connectedClient.hasFinished = true;

    if (connectedClient.type === RecordingType.PARTICIPANT) {
      this.challenge.markPlayerCompleted(client.getLoggedInRsn()!);
      this.playerManager.setPlayerInactive(
        client.getLoggedInRsn()!,
        this.challenge.getId(),
      );
    }

    const shouldUpdateTimes =
      connectedClient.primary || !this.challenge.areTimesConfirmed();
    if (shouldUpdateTimes) {
      this.challenge.setReportedTimes(challengeTicks, overallTicks);
    }

    if (this.isComplete()) {
      if (this.challenge.hasActiveStage()) {
        console.log(
          `${this}: All clients left before ending stage; starting abandonment timer`,
        );
        this.startReconnectionTimer();
        return false;
      }

      this.stopReconnectionTimer();
      await this.finish();
      return true;
    }

    return false;
  }

  public isComplete(): boolean {
    return this.clients.every((c) => c.hasFinished);
  }

  /**
   * Forcefully ends the challenge and deletes all associated data.
   */
  public async terminateAndPurgeChallenge(): Promise<void> {
    clearInterval(this.watchdogTimer);
    this.stopReconnectionTimer();

    const errorMessage = new ServerMessage();
    errorMessage.setType(ServerMessage.Type.ERROR);
    errorMessage.setActiveChallengeId(this.challenge.getId());
    const error = new ServerMessage.Error();
    error.setType(ServerMessage.Error.Type.CHALLENGE_RECORDING_ENDED);
    errorMessage.setError(error);

    this.clients.forEach((c) => {
      c.client.setActiveChallenge(null);
      c.client.sendMessage(errorMessage);
    });

    this.clients = [];
    await this.challengeManager.terminateChallenge(this.challenge);
  }

  public toString(): string {
    return `ChallengeStreamAggregator[${this.challenge.getId()}]`;
  }

  private updatePrimaryClient(): void {
    if (this.challenge.hasActiveStage()) {
      // Because only a single primary client is supported, a switch between
      // primaries necessarily loses data.
      this.challenge.markStageTimeInaccurate();
    }

    const newPrimary = this.clients.find((c) => c.active && !c.hasFinished);
    if (newPrimary !== undefined) {
      newPrimary.primary = true;
      console.log(`${this}: primary client set to ${newPrimary.client}`);
    } else {
      console.error(
        `${this}: cannot set a new primary client: no active clients`,
      );
      if (!this.isComplete()) {
        this.startReconnectionTimer();
      }
    }
  }

  private startReconnectionTimer(): void {
    if (this.reconnectionTimestamp === null) {
      this.reconnectionTimestamp = Date.now();
    }
  }

  private stopReconnectionTimer(): void {
    if (this.reconnectionTimestamp !== null) {
      this.reconnectionTimestamp = null;
    }
  }

  private async finish(): Promise<void> {
    clearInterval(this.watchdogTimer);
    await this.challengeManager.endChallenge(this.challenge.getId());
    this.clients.forEach((c) => c.client.setActiveChallenge(null));
  }

  private watchdog(): void {
    const now = Date.now();

    if (
      now - this.lastEventTimestamp >
      ChallengeStreamAggregator.MAX_INACTIVITY_PERIOD
    ) {
      const activeClients = this.clients.filter(
        (c) => c.active && !c.hasFinished,
      );
      if (activeClients.length > 0) {
        console.log(`${this}: clients not sending events; querying state`);
      }

      activeClients.forEach((c) => {
        const message = new ServerMessage();
        message.setType(ServerMessage.Type.CHALLENGE_STATE_CONFIRMATION);
        message.setActiveChallengeId(this.challenge.getId());
        const request = new ServerMessage.ChallengeStateConfirmation();
        request.setUsername(c.client.getLoggedInRsn()!);
        request.setChallenge(this.challenge.getType() as Proto<ChallengeMap>);
        request.setMode(this.challenge.getMode() as Proto<ChallengeModeMap>);
        request.setStage(this.challenge.getStage() as Proto<StageMap>);
        request.setPartyList(this.challenge.getParty());
        message.setChallengeStateConfirmation(request);

        c.client.sendMessage(message);
      });
    }

    const hasActiveClients = this.clients.some(
      (c) => c.active && !c.hasFinished,
    );
    if (
      this.reconnectionTimestamp !== null &&
      now - this.reconnectionTimestamp >
        ChallengeStreamAggregator.MAX_RECONNECTION_PERIOD
    ) {
      if (!hasActiveClients) {
        console.log(`${this}: ending due to reconnection timeout`);
        this.finish();
      } else {
        this.reconnectionTimestamp = null;
      }
    } else if (!hasActiveClients) {
      this.startReconnectionTimer();
    }
  }
}
