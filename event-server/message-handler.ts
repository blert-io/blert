import { ChallengeType, RecordingType } from '@blert/common';
import {
  ChallengeMap,
  ChallengeMode,
  ChallengeModeMap,
  Event,
  StageMap,
} from '@blert/common/generated/event_pb';
import { ServerMessage } from '@blert/common/generated/server_message_pb';

import { Challenge } from './challenge';
import ChallengeManager from './challenge-manager';
import Client from './client';
import { PlayerManager, Players } from './players';
import { Users } from './users';
import { ServerStatus, ServerStatusUpdate } from './server-manager';

type Proto<E> = E[keyof E];

type ConnectedClient = {
  client: Client;
  type: RecordingType;
  active: boolean;
  primary: boolean;
  hasFinished: boolean;
};

class ChallengeStreamAggregator {
  private challengeManager: ChallengeManager;
  private playerManager: PlayerManager;
  private challenge: Challenge;
  private onCompletion: () => void;
  private clients: ConnectedClient[];

  private lastEventTimestamp: number;
  private reconnectionTimestamp: number | null;
  private watchdogTimer: NodeJS.Timeout;

  /** How long to wait before cleaning up a challenge with no clients. */
  private static readonly MAX_RECONNECTION_PERIOD = 1000 * 60 * 5;

  /**
   * How long to wait before attempting to clean up a challenge not
   * receiving events.
   */
  private static readonly MAX_INACTIVITY_PERIOD = 1000 * 60 * 15;

  public constructor(
    challengeManager: ChallengeManager,
    playerManager: PlayerManager,
    challenge: Challenge,
    onCompletion: () => void,
  ) {
    this.challengeManager = challengeManager;
    this.playerManager = playerManager;
    this.challenge = challenge;
    this.onCompletion = onCompletion;
    this.clients = [];

    this.watchdogTimer = setInterval(() => this.watchdog(), 1000 * 60);
    this.reconnectionTimestamp = null;
    this.lastEventTimestamp = Date.now();
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
    if (client.getActiveChallenge() === this.challenge) {
      return;
    }

    if (client.getActiveChallenge() !== null) {
      console.error(
        `${client} is already in challenge ${client.getActiveChallenge()!.getId()}`,
      );
      return;
    }

    if (this.clients.find((c) => c.client === client)) {
      console.error(`${client} is already streaming to ${this}`);
      return;
    }

    client.setActiveChallenge(this.challenge);

    const hasPrimaryClient = this.clients.some((c) => c.primary);

    this.clients.push({
      client,
      type,
      active: true,
      primary: !hasPrimaryClient,
      hasFinished: false,
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
    connectedClient.primary = !hasPrimaryClient;

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
      this.updatePrimaryClient();
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
   */
  public async markCompletion(
    client: Client,
    overallTicks: number,
  ): Promise<void> {
    const connectedClient = this.clients.find((c) => c.client === client);
    if (!connectedClient) {
      console.error(`markCompletion: ${client} is not connected to ${this}`);
      return;
    }
    if (connectedClient.hasFinished) {
      return;
    }

    connectedClient.hasFinished = true;

    if (connectedClient.type === RecordingType.PARTICIPANT) {
      this.challenge.markPlayerCompleted(client.getLoggedInRsn()!);
      this.playerManager.setPlayerInactive(
        client.getLoggedInRsn()!,
        this.challenge.getId(),
      );
    }

    const shouldUpdateOverallTime =
      connectedClient.primary || this.challenge.getOverallTime() === 0;
    if (shouldUpdateOverallTime && overallTicks > 0) {
      this.challenge.setOverallTime(overallTicks);
    }

    if (this.isComplete()) {
      this.stopReconnectionTimer();
      await this.finish();
    }
  }

  public isComplete(): boolean {
    return this.clients.every((c) => c.hasFinished);
  }

  /**
   * Forcefully ends the challenge and deletes all associated data.
   */
  public async terminateAndPurgeChallenge(): Promise<void> {
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
    // Because only a single primary client is supported, a switch between
    // primaries necessarily loses data.
    this.challenge.markStageTimeInaccurate();

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
    await this.challengeManager.endChallenge(this.challenge);
    this.clients.forEach((c) => c.client.setActiveChallenge(null));
    this.onCompletion();
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

export default class MessageHandler {
  private challengeManager: ChallengeManager;
  private playerManager: PlayerManager;
  private challengeAggregators: { [raidId: string]: ChallengeStreamAggregator };

  private allowStartingChallenges: boolean;

  public constructor(
    challengeManager: ChallengeManager,
    playerManager: PlayerManager,
  ) {
    this.challengeManager = challengeManager;
    this.playerManager = playerManager;
    this.challengeAggregators = {};
    this.allowStartingChallenges = true;
  }

  public closeClient(client: Client): void {
    const challenge = client.getActiveChallenge();
    if (challenge !== null) {
      this.challengeAggregators[challenge.getId()]?.removeClient(client);
    }
  }

  public handleServerStatusUpdate = ({ status }: ServerStatusUpdate): void => {
    if (status === ServerStatus.SHUTDOWN_PENDING) {
      this.allowStartingChallenges = false;
      console.log(
        'MessageHandler denying new challenges due to pending shutdown',
      );
    } else if (status === ServerStatus.SHUTDOWN_CANCELED) {
      this.allowStartingChallenges = true;
      console.log('MessageHandler allowing new challenges');
    }
  };

  /**
   * Processes an incoming message from a client.
   * @param client The client that sent the message.
   * @param message The message.
   */
  public async handleMessage(
    client: Client,
    message: ServerMessage,
  ): Promise<void> {
    switch (message.getType()) {
      case ServerMessage.Type.HISTORY_REQUEST:
        const history = await Users.getChallengeHistory(client.getUserId());

        const historyResponse = new ServerMessage();
        historyResponse.setType(ServerMessage.Type.HISTORY_RESPONSE);

        historyResponse.setRecentRecordingsList(
          history.map((challenge) => {
            const pastRaid = new ServerMessage.PastChallenge();
            pastRaid.setChallenge(challenge.type as Proto<ChallengeMap>);
            pastRaid.setId(challenge.id);
            pastRaid.setStatus(
              challenge.status as Proto<ServerMessage.PastChallenge.StatusMap>,
            );
            pastRaid.setStage(challenge.stage as Proto<StageMap>);
            pastRaid.setMode(challenge.mode as Proto<ChallengeModeMap>);
            pastRaid.setPartyList(challenge.party);
            return pastRaid;
          }),
        );

        client.sendMessage(historyResponse);
        break;

      case ServerMessage.Type.GAME_STATE:
        await this.handleGameStateUpdate(client, message.getGameState()!);
        break;

      case ServerMessage.Type.CHALLENGE_STATE_CONFIRMATION: {
        // A client's response to a previous CHALLENGE_STATE_CONFIRMATION
        // request. If the challenge state is not valid, the player has left the
        // challenge, so remove them.
        const confirmation = message.getChallengeStateConfirmation()!;
        const rsn = confirmation.getUsername().toLowerCase();

        const aggregator =
          this.challengeAggregators[message.getActiveChallengeId()];

        if (confirmation.getIsValid()) {
          if (client.getActiveChallenge() === null) {
            if (aggregator !== undefined) {
              const isParticipant = aggregator
                .getChallenge()
                .getParty()
                .some((p) => p.toLowerCase() === rsn);
              aggregator.addClient(
                client,
                isParticipant
                  ? RecordingType.PARTICIPANT
                  : RecordingType.SPECTATOR,
              );
            }

            console.log(
              `${client}: player ${rsn} rejoining challenge ${message.getActiveChallengeId()}`,
            );
          }
        } else {
          if (aggregator !== undefined) {
            await aggregator.markCompletion(client, 0);
            aggregator.removeClient(client);
          }

          const challenge = this.challengeManager.get(
            message.getActiveChallengeId(),
          );
          if (challenge !== undefined) {
            challenge.markPlayerCompleted(rsn);
          }
          this.playerManager.setPlayerInactive(
            rsn,
            message.getActiveChallengeId(),
          );

          console.log(
            `${client}: player ${rsn} is no longer in challenge ${message.getActiveChallengeId()}`,
          );

          const errorMessage = new ServerMessage();
          errorMessage.setType(ServerMessage.Type.ERROR);
          errorMessage.setActiveChallengeId(message.getActiveChallengeId());
          const error = new ServerMessage.Error();
          error.setType(ServerMessage.Error.Type.CHALLENGE_RECORDING_ENDED);
          errorMessage.setError(error);
          client.sendMessage(errorMessage);
        }
        break;
      }

      case ServerMessage.Type.EVENT_STREAM:
        const events = message
          .getChallengeEventsList()
          .sort((a, b) => a.getTick() - b.getTick());
        for (const event of events) {
          try {
            await this.handleChallengeEvent(client, event);
          } catch (e) {
            console.error(`${client} Failed to handle event: ${e}`);
          }
        }
        break;

      default:
        console.error(`Unknown message type: ${message.getType()}`);
        break;
    }
  }

  private async handleChallengeEvent(
    client: Client,
    event: Event,
  ): Promise<void> {
    switch (event.getType()) {
      case Event.Type.CHALLENGE_START:
        await this.handleChallengeStart(client, event);
        break;

      case Event.Type.CHALLENGE_END: {
        if (event.getChallengeId() === '') {
          return;
        }

        const aggregator = this.challengeAggregators[event.getChallengeId()];
        if (aggregator === undefined) {
          console.error(
            `No aggregator for challenge ${event.getChallengeId()}`,
          );
          return;
        }

        const completed = event.getCompletedChallenge()!;
        const overallTicks = completed.getOverallTimeTicks();

        await aggregator.markCompletion(client, overallTicks);
        break;
      }

      case Event.Type.CHALLENGE_UPDATE:
        const challengeInfo = event.getChallengeInfo()!;
        if (event.getChallengeId() !== '' && challengeInfo?.getMode()) {
          const aggregator = this.challengeAggregators[event.getChallengeId()];
          if (aggregator) {
            if (challengeInfo.getMode() === ChallengeMode.TOB_ENTRY) {
              // TODO(frolv): At some point in the future, allow entry mode
              // raids to be recorded.
              console.log(`Terminating ToB entry mode raid ${aggregator}`);
              delete this.challengeAggregators[event.getChallengeId()];
              await aggregator.terminateAndPurgeChallenge();
            } else {
              await aggregator.getChallenge().setMode(challengeInfo.getMode());
            }
          } else {
            console.error(
              'Received CHALLENGE_UPDATE event for nonexistent raid',
              event.getChallengeId(),
            );
          }
        }
        break;

      default:
        if (event.getChallengeId() == '') {
          return;
        }

        if (event.getChallengeId() !== client.getActiveChallenge()?.getId()) {
          console.error(
            `${client} sent event for challenge ${event.getChallengeId()}, but is not in it.`,
          );
          return;
        }

        const aggregator = this.challengeAggregators[event.getChallengeId()];
        if (aggregator) {
          await aggregator.process(client, event);
        } else {
          console.error(
            `No aggregator for challenge ${event.getChallengeId()}`,
          );
        }
    }
  }

  /**
   * Processes a CHALLENGE_START event, starting a new challenge if possible.
   * @param client The client that sent the event.
   * @param event The event.
   */
  private async handleChallengeStart(
    client: Client,
    event: Event,
  ): Promise<void> {
    const response = new ServerMessage();
    response.setType(ServerMessage.Type.ACTIVE_CHALLENGE_INFO);

    if (!this.allowStartingChallenges) {
      // TODO(frolv): Use a proper error type instead of an empty ID.
      client.sendMessage(response);
      return;
    }

    const username = await Players.lookupUsername(client.getLinkedPlayerId());

    if (username === null) {
      console.log(`${client} is not linked to a player; closing`);
      client.sendUnauthenticatedAndClose();
      return;
    }

    const challengeInfo = event.getChallengeInfo()!;

    const challengeType = challengeInfo.getChallenge();
    const partySize = challengeInfo.getPartyList().length;

    const checkPartySize = (minSize: number, maxSize?: number): boolean => {
      maxSize = maxSize ?? minSize;
      if (partySize < minSize || partySize > maxSize) {
        console.error(
          `Received CHALLENGE_START event for ${challengeType} with invalid party size: ${partySize}`,
        );

        // TODO(frolv): Use a proper error type instead of an empty ID.
        client.sendMessage(response);
        return false;
      }
      return true;
    };

    switch (challengeType) {
      case ChallengeType.TOB:
        if (!checkPartySize(1, 5)) {
          return;
        }
        if (challengeInfo.getMode() === ChallengeMode.TOB_ENTRY) {
          console.log(`${client}: denying ToB entry mode raid`);
          client.sendMessage(response);
          return;
        }
        break;

      case ChallengeType.COLOSSEUM:
        if (!checkPartySize(1)) {
          return;
        }
        break;

      case ChallengeType.COX:
      case ChallengeType.TOA:
      case ChallengeType.INFERNO:
        console.error(
          `Received CHALLENGE_START event for unimplemented challenge: ${challengeType}`,
        );

        // TODO(frolv): Use a proper error type instead of an empty ID.
        client.sendMessage(response);
        return;

      default:
        console.error(
          `Received CHALLENGE_START event with unknown challenge: ${challengeType}`,
        );

        // TODO(frolv): Use a proper error type instead of an empty ID.
        client.sendMessage(response);
        return;
    }

    let challenge: Challenge;
    try {
      challenge = await this.challengeManager.startOrJoin(
        client,
        challengeType,
        challengeInfo.getMode(),
        challengeInfo.getPartyList(),
      );
    } catch (e: any) {
      console.error(`Failed to start or join challenge: ${e}`);
      client.sendMessage(response);
      return;
    }

    response.setActiveChallengeId(challenge.getId());
    client.sendMessage(response);

    const recordingType = challengeInfo.getSpectator()
      ? RecordingType.SPECTATOR
      : RecordingType.PARTICIPANT;

    const challengeId = challenge.getId();

    if (!this.challengeAggregators[challengeId]) {
      const onChallengeCompletion = () => {
        console.log(`MessageHandler cleaning up challenge ${challengeId}`);
        delete this.challengeAggregators[challengeId];
      };

      this.challengeAggregators[challengeId] = new ChallengeStreamAggregator(
        this.challengeManager,
        this.playerManager,
        challenge,
        onChallengeCompletion,
      );
    }
    this.challengeAggregators[challengeId].addClient(client, recordingType);

    await Users.addRecordedChallenge(
      client.getUserId(),
      challenge.getDatabaseId(),
      recordingType,
    );
  }

  private async handleGameStateUpdate(
    client: Client,
    gameState: ServerMessage.GameState,
  ): Promise<void> {
    if (gameState.getState() === ServerMessage.GameState.State.LOGGED_IN) {
      const playerInfo = gameState.getPlayerInfo()!;
      const rsn = playerInfo.getUsername().toLowerCase();
      const username = await Players.lookupUsername(client.getLinkedPlayerId());

      if (username === null) {
        client.sendUnauthenticatedAndClose();
        return;
      }

      client.setLoggedInRsn(rsn);

      if (rsn !== username.toLowerCase()) {
        const error = new ServerMessage();
        error.setType(ServerMessage.Type.ERROR);
        const rsnError = new ServerMessage.Error();
        rsnError.setType(ServerMessage.Error.Type.USERNAME_MISMATCH);
        rsnError.setUsername(username);
        error.setError(rsnError);
        client.sendMessage(error);
      } else {
        // When a player logs in, request a confirmation of their active
        // challenge state to synchronize with the server.
        this.requestChallengeStateConfirmation(client, rsn);
        await Players.updateExperience(rsn, playerInfo.toObject());
      }
    } else {
      // Client has logged out.
      client.setLoggedInRsn(null);
    }

    const challenge = client.getActiveChallenge();
    if (challenge !== null) {
      const aggregator = this.challengeAggregators[challenge.getId()];
      if (aggregator !== undefined) {
        switch (gameState.getState()) {
          case ServerMessage.GameState.State.LOGGED_IN:
            aggregator.setClientActive(client);
            break;

          case ServerMessage.GameState.State.LOGGED_OUT:
            aggregator.setClientInactive(client);
            break;

          default:
            console.error(
              `${client}: Unknown game state: ${gameState.getState()}`,
            );
            break;
        }
      }
    }
  }

  private requestChallengeStateConfirmation(client: Client, rsn: string): void {
    const challengeId = this.playerManager.getCurrentChallengeId(rsn);
    if (challengeId === undefined) {
      return;
    }

    const activeChallenge = this.challengeManager.get(challengeId);
    if (activeChallenge === undefined) {
      return;
    }

    const message = new ServerMessage();
    message.setType(ServerMessage.Type.CHALLENGE_STATE_CONFIRMATION);
    message.setActiveChallengeId(challengeId);
    const request = new ServerMessage.ChallengeStateConfirmation();
    request.setUsername(rsn);
    request.setChallenge(activeChallenge.getType() as Proto<ChallengeMap>);
    request.setMode(activeChallenge.getMode() as Proto<ChallengeModeMap>);
    request.setStage(activeChallenge.getStage() as Proto<StageMap>);
    request.setPartyList(activeChallenge.getParty());
    message.setChallengeStateConfirmation(request);

    client.sendMessage(message);
  }
}
