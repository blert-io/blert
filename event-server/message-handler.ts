import {
  ChallengeType,
  RecordedChallengeModel,
  RecordingType,
} from '@blert/common';
import {
  ChallengeMap,
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
  private clients: ConnectedClient[];

  private cleanupTimer: NodeJS.Timeout | null;

  public constructor(
    challengeManager: ChallengeManager,
    playerManager: PlayerManager,
    challenge: Challenge,
  ) {
    this.challengeManager = challengeManager;
    this.playerManager = playerManager;
    this.challenge = challenge;
    this.clients = [];
    this.cleanupTimer = null;
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

    this.stopCleanupTimer();
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
      this.startCleanupTimer();
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
      console.error(`${client} is not connected ${this}`);
      return;
    }

    connectedClient.active = true;

    const hasPrimaryClient = this.clients.some((c) => c.primary);
    connectedClient.primary = !hasPrimaryClient;

    this.stopCleanupTimer();
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
      console.error(`${client} is not connected to ${this}`);
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
      console.error(`${client} is not connected to ${this}`);
      return;
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
   */
  public markCompletion(client: Client, overallTicks: number): void {
    const connectedClient = this.clients.find((c) => c.client === client);
    if (!connectedClient) {
      console.error(`${client} is not connected to ${this}`);
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
      this.stopCleanupTimer();
      this.finishChallenge();
    }
  }

  public isComplete(): boolean {
    return this.clients.every((c) => c.hasFinished);
  }

  public toString(): string {
    return `ChallengeStreamAggregator[${this.challenge.getId()}]`;
  }

  private updatePrimaryClient(): void {
    const newPrimary = this.clients.find((c) => c.active && !c.hasFinished);
    if (newPrimary !== undefined) {
      newPrimary.primary = true;
      console.log(`${this}: primary client set to ${newPrimary.client}`);
    } else {
      console.error(
        `${this}: cannot set a new primary client: no active clients`,
      );
      if (!this.isComplete()) {
        this.startCleanupTimer();
      }
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setTimeout(
      () => {
        if (this.clients.length === 0) {
          console.log(`Cleaning up challenge ${this.challenge.getId()}`);
          this.finishChallenge();
        }
      },
      1000 * 60 * 5,
    );
  }

  private finishChallenge(): void {
    this.challengeManager.endChallenge(this.challenge);
    this.clients.forEach((c) => c.client.setActiveChallenge(null));
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer !== null) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
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

        if (confirmation.getIsValid()) {
          if (client.getActiveChallenge() === null) {
            const aggregator =
              this.challengeAggregators[message.getActiveChallengeId()];
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
        }
        break;
      }

      case ServerMessage.Type.EVENT_STREAM:
        const events = message
          .getChallengeEventsList()
          .sort((a, b) => a.getTick() - b.getTick());
        for (const event of events) {
          await this.handleChallengeEvent(client, event);
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

        aggregator.markCompletion(client, overallTicks);

        if (aggregator.isComplete()) {
          delete this.challengeAggregators[event.getChallengeId()];
        }
        break;
      }

      case Event.Type.CHALLENGE_UPDATE:
        if (
          event.getChallengeId() !== '' &&
          event.getChallengeInfo()?.getMode()
        ) {
          const raid = this.challengeManager.get(event.getChallengeId());
          if (raid) {
            await raid.setMode(event.getChallengeInfo()!.getMode());
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

    if (!this.allowStartingChallenges) {
      // TODO(frolv): Use a proper error type instead of an empty ID.
      response.setType(ServerMessage.Type.ACTIVE_CHALLENGE_INFO);
      client.sendMessage(response);
      return;
    }

    const player = await Players.findById(client.getLinkedPlayerId(), {
      username: 1,
    });

    if (player === null) {
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
        response.setType(ServerMessage.Type.ACTIVE_CHALLENGE_INFO);
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
        break;

      case ChallengeType.COLOSSEUM:
        if (process.env.TEST_COLOSSEUM !== '1') {
          console.error(
            'Received CHALLENGE_START event for unimplemented challenge: COLOSSEUM',
          );
          response.setType(ServerMessage.Type.ACTIVE_CHALLENGE_INFO);
          client.sendMessage(response);
          return;
        }
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
        response.setType(ServerMessage.Type.ACTIVE_CHALLENGE_INFO);
        client.sendMessage(response);
        return;

      default:
        console.error(
          `Received CHALLENGE_START event with unknown challenge: ${challengeType}`,
        );

        // TODO(frolv): Use a proper error type instead of an empty ID.
        response.setType(ServerMessage.Type.ACTIVE_CHALLENGE_INFO);
        client.sendMessage(response);
        return;
    }

    const challenge = await this.challengeManager.startOrJoin(
      client,
      challengeType,
      challengeInfo.getMode(),
      challengeInfo.getPartyList(),
    );

    response.setType(ServerMessage.Type.ACTIVE_CHALLENGE_INFO);
    response.setActiveChallengeId(challenge.getId());
    client.sendMessage(response);

    const recordingType = challengeInfo.getSpectator()
      ? RecordingType.SPECTATOR
      : RecordingType.PARTICIPANT;

    if (!this.challengeAggregators[challenge.getId()]) {
      this.challengeAggregators[challenge.getId()] =
        new ChallengeStreamAggregator(
          this.challengeManager,
          this.playerManager,
          challenge,
        );
    }
    this.challengeAggregators[challenge.getId()].addClient(
      client,
      recordingType,
    );

    const recordedChallenge = new RecordedChallengeModel({
      recorderId: client.getUserId(),
      cId: challenge.getId(),
      recordingType,
    });
    await recordedChallenge.save();
  }

  private async handleGameStateUpdate(
    client: Client,
    gameState: ServerMessage.GameState,
  ): Promise<void> {
    if (gameState.getState() === ServerMessage.GameState.State.LOGGED_IN) {
      const playerInfo = gameState.getPlayerInfo()!;
      const rsn = playerInfo.getUsername().toLowerCase();
      const player = await Players.findById(client.getLinkedPlayerId(), {
        username: 1,
        formattedUsername: 1,
      });

      if (player === null) {
        client.sendUnauthenticatedAndClose();
        return;
      }

      client.setLoggedInRsn(rsn);

      if (rsn !== player.username) {
        const error = new ServerMessage();
        error.setType(ServerMessage.Type.ERROR);
        const rsnError = new ServerMessage.Error();
        rsnError.setType(ServerMessage.Error.Type.USERNAME_MISMATCH);
        rsnError.setUsername(player.formattedUsername);
        error.setError(rsnError);
        client.sendMessage(error);
      } else {
        // When a player logs in, request a confirmation of their active
        // challenge state to synchronize with the server.
        this.requestChallengeStateConfirmation(client, rsn);

        if (
          playerInfo.getUsername() !== '' &&
          playerInfo.getOverallExperience() > 0
        ) {
          player.formattedUsername = playerInfo.getUsername();
          player.overallExperience = playerInfo.getOverallExperience();
          await player.save();
        }
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
