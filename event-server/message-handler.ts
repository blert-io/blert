import {
  ChallengeType,
  ClientStatus,
  RecordingType,
  Stage,
} from '@blert/common';
import {
  ChallengeMap,
  ChallengeMode,
  ChallengeModeMap,
  StageMap,
} from '@blert/common/generated/event_pb';
import {
  ChallengeStartRequest,
  ChallengeEndRequest,
  ServerMessage,
  ChallengeUpdate as ChallengeUpdateProto,
} from '@blert/common/generated/server_message_pb';

import ChallengeManager, { ChallengeUpdate } from './challenge-manager';
import Client from './client';
import { PlayerManager, Players } from './players';
import { Users } from './users';
import { ServerStatus, ServerStatusUpdate } from './server-manager';

type Proto<E> = E[keyof E];

export default class MessageHandler {
  private challengeManager: ChallengeManager;
  private playerManager: PlayerManager;

  private allowStartingChallenges: boolean;

  public constructor(
    challengeManager: ChallengeManager,
    playerManager: PlayerManager,
  ) {
    this.challengeManager = challengeManager;
    this.playerManager = playerManager;
    this.allowStartingChallenges = true;
  }

  public closeClient(client: Client): void {
    this.challengeManager.updateClientStatus(client, ClientStatus.DISCONNECTED);
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
          if (client.getActiveChallenge() !== message.getActiveChallengeId()) {
            const added = await this.challengeManager.addClient(
              client,
              message.getActiveChallengeId(),
              confirmation.getSpectator()
                ? RecordingType.SPECTATOR
                : RecordingType.PARTICIPANT,
            );

            if (added) {
              console.log(
                `${client}: player ${rsn} rejoining challenge ${message.getActiveChallengeId()}`,
              );
            } else {
              console.error(
                `${client}: failed to rejoin challenge ${message.getActiveChallengeId()}`,
              );
            }
          }
        } else {
          await this.challengeManager.completeChallenge(
            client,
            message.getActiveChallengeId(),
            null,
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

      case ServerMessage.Type.CHALLENGE_START_REQUEST:
        this.handleChallengeStart(
          client,
          message,
          message.getChallengeStartRequest()!,
        );
        break;

      case ServerMessage.Type.CHALLENGE_END_REQUEST:
        this.handleChallengeEnd(
          client,
          message,
          message.getChallengeEndRequest()!,
        );
        break;

      case ServerMessage.Type.CHALLENGE_UPDATE:
        if (message.getActiveChallengeId() !== '') {
          this.handleChallengeUpdate(
            client,
            message.getActiveChallengeId(),
            message.getChallengeUpdate()!,
          );
        } else {
          console.error('Received CHALLENGE_UPDATE event with no challenge ID');
        }
        break;

      case ServerMessage.Type.EVENT_STREAM: {
        const challengeId = message.getActiveChallengeId();
        if (challengeId === '') {
          console.error('Received EVENT_STREAM event with no challenge ID');
          return;
        }

        const events = message
          .getChallengeEventsList()
          .sort((a, b) => a.getTick() - b.getTick());
        try {
          await this.challengeManager.processEvents(
            client,
            challengeId,
            events,
          );
        } catch (e) {
          console.error(`${client} Failed to handle events: ${e}`);
        }
        break;
      }

      default:
        console.error(`Unknown message type: ${message.getType()}`);
        break;
    }
  }

  /**
   * Processes a CHALLENGE_START_REQUEST, starting a new challenge if possible.
   * @param client The client that sent the request.
   * @param message The server message containing the request.
   * @param request The challenge start request.
   */
  private async handleChallengeStart(
    client: Client,
    message: ServerMessage,
    request: ChallengeStartRequest,
  ): Promise<void> {
    const response = new ServerMessage();
    response.setType(ServerMessage.Type.CHALLENGE_START_RESPONSE);
    response.setRequestId(message.getRequestId());

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

    const challengeType = request.getChallenge();
    const partySize = request.getPartyList().length;

    const checkPartySize = (minSize: number, maxSize?: number): boolean => {
      maxSize = maxSize ?? minSize;
      if (partySize < minSize || partySize > maxSize) {
        console.error(
          `Received CHALLENGE_START_REQUEST for type ${challengeType} ` +
            `with invalid party size: ${partySize}`,
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
        if (request.getMode() === ChallengeMode.TOB_ENTRY) {
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
          `Received CHALLENGE_START_REQUEST for unimplemented type: ${challengeType}`,
        );

        // TODO(frolv): Use a proper error type instead of an empty ID.
        client.sendMessage(response);
        return;

      default:
        console.error(
          `Received CHALLENGE_START_REQUEST for unknown type: ${challengeType}`,
        );

        // TODO(frolv): Use a proper error type instead of an empty ID.
        client.sendMessage(response);
        return;
    }

    const stage = request.getStage() as Stage;

    const recordingType = request.getSpectator()
      ? RecordingType.SPECTATOR
      : RecordingType.PARTICIPANT;

    if (
      challengeType === ChallengeType.TOB &&
      recordingType === RecordingType.SPECTATOR
    ) {
      const error = new ServerMessage.Error();
      error.setType(ServerMessage.Error.Type.CHALLENGE_RECORDING_ENDED);
      error.setMessage('Recording as a spectator is temporary disabled.');
      response.setError(error);
      client.sendMessage(response);
      return;
    }

    let challengeId: string;
    try {
      challengeId = await this.challengeManager.startOrJoin(
        client,
        challengeType,
        request.getMode(),
        request.getPartyList(),
        stage,
        recordingType,
      );
    } catch (e: any) {
      console.error(`Failed to start or join challenge: ${e}`);
      client.sendMessage(response);
      return;
    }

    response.setActiveChallengeId(challengeId);
    client.sendMessage(response);
  }

  private async handleChallengeEnd(
    client: Client,
    message: ServerMessage,
    request: ChallengeEndRequest,
  ) {
    if (message.getActiveChallengeId() === '') {
      console.error(
        `${client} sent CHALLENGE_END_REQUEST with no challenge ID`,
      );
      return;
    }

    this.challengeManager.completeChallenge(
      client,
      message.getActiveChallengeId(),
      {
        challenge: request.getChallengeTimeTicks(),
        overall: request.getOverallTimeTicks(),
      },
    );

    const response = new ServerMessage();
    response.setType(ServerMessage.Type.CHALLENGE_END_RESPONSE);
    response.setRequestId(message.getRequestId());
    client.sendMessage(response);
  }

  private async handleChallengeUpdate(
    client: Client,
    challengeId: string,
    update: ChallengeUpdateProto,
  ) {
    if (challengeId !== client.getActiveChallenge()) {
      console.error(
        `${client} sent CHALLENGE_UPDATE event for challenge ${challengeId}, ` +
          'but is not in it.',
      );
      return;
    }

    let challengeUpdate: ChallengeUpdate = {
      mode: update.getMode(),
    };

    if (update.hasStageUpdate()) {
      const stageUpdate = update.getStageUpdate()!;

      challengeUpdate.stage = {
        stage: stageUpdate.getStage(),
        status: stageUpdate.getStatus(),
        accurate: stageUpdate.getAccurate(),
        recordedTicks: stageUpdate.getRecordedTicks(),
        serverTicks: stageUpdate.hasGameServerTicks()
          ? {
              count: stageUpdate.getGameServerTicks(),
              precise: stageUpdate.getGameTicksPrecise(),
            }
          : null,
      };
    }

    try {
      this.challengeManager.updateChallenge(
        client,
        challengeId,
        challengeUpdate,
      );
    } catch (e) {
      console.error(`${client} Failed to update challenge: ${e}`);
    }
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
        await Promise.all([
          this.requestChallengeStateConfirmation(client, rsn),
          Players.updateExperience(rsn, playerInfo.toObject()),
        ]);
      }
    } else {
      // Client has logged out.
      client.setLoggedInRsn(null);
    }

    switch (gameState.getState()) {
      case ServerMessage.GameState.State.LOGGED_IN:
        this.challengeManager.updateClientStatus(client, ClientStatus.ACTIVE);
        break;

      case ServerMessage.GameState.State.LOGGED_OUT:
        this.challengeManager.updateClientStatus(client, ClientStatus.IDLE);
        break;

      default:
        console.error(`${client}: Unknown game state: ${gameState.getState()}`);
        break;
    }
  }

  private async requestChallengeStateConfirmation(
    client: Client,
    rsn: string,
  ): Promise<void> {
    const challengeId = await this.playerManager.getCurrentChallengeId(rsn);
    if (challengeId === null) {
      return;
    }

    const challenge = await this.challengeManager.getChallengeInfo(challengeId);
    if (challenge === null) {
      return;
    }

    const message = new ServerMessage();
    message.setType(ServerMessage.Type.CHALLENGE_STATE_CONFIRMATION);
    message.setActiveChallengeId(challengeId);
    const request = new ServerMessage.ChallengeStateConfirmation();
    request.setUsername(rsn);
    request.setChallenge(challenge.type as Proto<ChallengeMap>);
    request.setMode(challenge.mode as Proto<ChallengeModeMap>);
    request.setStage(challenge.stage as Proto<StageMap>);
    request.setPartyList(challenge.party);
    message.setChallengeStateConfirmation(request);

    client.sendMessage(message);
  }
}
