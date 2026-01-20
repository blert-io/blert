import {
  ChallengeType,
  ClientStatus,
  isPostgresUniqueViolation,
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
import { Timestamp } from 'google-protobuf/google/protobuf/timestamp_pb';

import ChallengeManager, {
  ChallengeStatusResponse,
  ChallengeUpdate,
} from './challenge-manager';
import Client from './client';
import { PlayerManager, Players } from './players';
import { Users } from './users';
import { ServerStatus, ServerStatusUpdate } from './server-manager';
import logger from './log';
import {
  ChallengeStartResult,
  recordChallengeEnd,
  recordChallengeStart,
  recordChallengeUpdate,
  recordEventStreamBatch,
  recordRemoteOperation,
} from './metrics';

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
      logger.warn('message_handler_start_blocked', { status });
    } else if (status === ServerStatus.SHUTDOWN_CANCELED) {
      this.allowStartingChallenges = true;
      logger.info('message_handler_start_allowed', { status });
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
            pastRaid.setId(challenge.id);
            pastRaid.setChallenge(challenge.type as Proto<ChallengeMap>);
            pastRaid.setMode(challenge.mode as Proto<ChallengeModeMap>);
            pastRaid.setStage(challenge.stage as Proto<StageMap>);
            pastRaid.setStatus(
              challenge.status as Proto<ServerMessage.PastChallenge.StatusMap>,
            );
            const timestamp = new Timestamp();
            timestamp.setSeconds(
              Math.floor(challenge.timestamp.getTime() / 1000),
            );
            timestamp.setNanos(
              (challenge.timestamp.getTime() % 1000) * 1000000,
            );
            pastRaid.setTimestamp(timestamp);
            pastRaid.setChallengeTicks(challenge.challengeTicks);
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
          if (
            client.getActiveChallengeId() !== message.getActiveChallengeId()
          ) {
            const result = await this.challengeManager.addClient(
              client,
              message.getActiveChallengeId(),
              confirmation.getSpectator()
                ? RecordingType.SPECTATOR
                : RecordingType.PARTICIPANT,
            );

            if (result !== null) {
              logger.info('client_rejoined_challenge', {
                username: client.getUsername(),
                rsn,
                challengeUuid: message.getActiveChallengeId(),
              });
              client.setActiveChallenge(result.uuid);
              client.setStageAttempt(result.stage, result.stageAttempt);
            } else {
              logger.warn('client_rejoin_failed', {
                username: client.getUsername(),
                rsn,
                challengeUuid: message.getActiveChallengeId(),
              });
            }
          }
        } else {
          await this.challengeManager.completeChallenge(
            client,
            message.getActiveChallengeId(),
            null,
          );

          logger.info('client_left_challenge', {
            username: client.getUsername(),
            rsn,
            challengeUuid: message.getActiveChallengeId(),
          });

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
        await this.handleChallengeStart(
          client,
          message,
          message.getChallengeStartRequest()!,
        );
        break;

      case ServerMessage.Type.CHALLENGE_END_REQUEST:
        await this.handleChallengeEnd(
          client,
          message,
          message.getChallengeEndRequest()!,
        );
        break;

      case ServerMessage.Type.CHALLENGE_UPDATE:
        if (message.getActiveChallengeId() !== '') {
          await this.handleChallengeUpdate(
            client,
            message.getActiveChallengeId(),
            message.getChallengeUpdate()!,
          );
        } else {
          logger.warn('challenge_update_missing_id');
        }
        break;

      case ServerMessage.Type.EVENT_STREAM: {
        const challengeId = message.getActiveChallengeId();
        if (challengeId === '') {
          logger.warn('event_stream_missing_id');
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
          recordRemoteOperation('process_events', 'success');
          recordEventStreamBatch('success');
        } catch (e) {
          recordRemoteOperation('process_events', 'error');
          recordEventStreamBatch('error');
          logger.error('event_stream_processing_failed', {
            challengeUuid: challengeId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      }

      default:
        logger.warn('unknown_message_type', { type: message.getType() });
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

    const challengeType = request.getChallenge() as ChallengeType;
    const stage = request.getStage() as Stage;

    const recordingType = request.getSpectator()
      ? RecordingType.SPECTATOR
      : RecordingType.PARTICIPANT;

    const recordStartResult = (result: ChallengeStartResult) =>
      recordChallengeStart(challengeType, recordingType, result);

    if (!this.allowStartingChallenges) {
      recordStartResult('blocked');
      // TODO(frolv): Use a proper error type instead of an empty ID.
      client.sendMessage(response);
      return;
    }

    const username = await Players.lookupUsername(client.getLinkedPlayerId());

    if (username === null) {
      logger.warn('client_missing_linked_player');
      recordStartResult('missing_linked_player');
      client.sendUnauthenticatedAndClose();
      return;
    }

    const partySize = request.getPartyList().length;

    const checkPartySize = (minSize: number, maxSize?: number): boolean => {
      maxSize = maxSize ?? minSize;
      if (partySize < minSize || partySize > maxSize) {
        logger.warn('challenge_start_invalid_party_size', {
          challengeType,
          partySize,
        });
        recordStartResult('invalid_party_size');

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
          logger.info('challenge_start_blocked_type', {
            challengeType,
            challengeMode: request.getMode(),
          });
          recordStartResult('blocked');
          client.sendMessage(response);
          return;
        }
        break;

      case ChallengeType.COLOSSEUM:
      case ChallengeType.INFERNO:
      case ChallengeType.MOKHAIOTL:
        if (!checkPartySize(1)) {
          return;
        }
        break;

      case ChallengeType.COX:
      case ChallengeType.TOA:
        logger.warn('challenge_start_unimplemented_type', { challengeType });
        recordStartResult('unimplemented');

        // TODO(frolv): Use a proper error type instead of an empty ID.
        client.sendMessage(response);
        return;

      default:
        logger.warn('challenge_start_unknown_type', { challengeType });
        recordStartResult('unknown');

        // TODO(frolv): Use a proper error type instead of an empty ID.
        client.sendMessage(response);
        return;
    }

    let status: ChallengeStatusResponse;
    try {
      status = await this.challengeManager.startOrJoin(
        client,
        challengeType,
        request.getMode(),
        request.getPartyList(),
        stage,
        recordingType,
      );
      recordRemoteOperation('start', 'success');
    } catch (e: any) {
      recordRemoteOperation('start', 'error');
      logger.error('challenge_start_failed', {
        error: e instanceof Error ? e : new Error(String(e)),
      });
      recordStartResult('error');
      client.sendMessage(response);
      return;
    }

    client.setActiveChallenge(status.uuid);
    client.setStageAttempt(status.stage, status.stageAttempt);
    response.setActiveChallengeId(status.uuid);
    client.sendMessage(response);
    recordStartResult('started');
  }

  private async handleChallengeEnd(
    client: Client,
    message: ServerMessage,
    request: ChallengeEndRequest,
  ) {
    if (message.getActiveChallengeId() === '') {
      logger.warn('challenge_end_missing_id');
      return;
    }

    try {
      await this.challengeManager.completeChallenge(
        client,
        message.getActiveChallengeId(),
        {
          challenge: request.getChallengeTimeTicks(),
          overall: request.getOverallTimeTicks(),
        },
      );
      recordRemoteOperation('complete', 'success');
      recordChallengeEnd('success');
    } catch (e) {
      recordRemoteOperation('complete', 'error');
      recordChallengeEnd('error');
      throw e;
    }

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
    if (challengeId !== client.getActiveChallengeId()) {
      logger.warn('challenge_update_wrong_challenge', {
        challengeUuid: challengeId,
      });
      recordChallengeUpdate('wrong_challenge');
      return;
    }

    const challengeUpdate: ChallengeUpdate = {
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
      const result = await this.challengeManager.updateChallenge(
        client,
        challengeId,
        challengeUpdate,
      );
      if (result === null) {
        throw new Error('ChallengeManager returned null');
      }
      client.setStageAttempt(result.stage, result.stageAttempt);
      recordRemoteOperation('update', 'success');
      recordChallengeUpdate('success');
    } catch (e) {
      recordRemoteOperation('update', 'error');
      recordChallengeUpdate('error');
      logger.error('challenge_update_failed', {
        challengeUuid: challengeId,
        error: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  private async handleGameStateUpdate(
    client: Client,
    gameState: ServerMessage.GameState,
  ): Promise<void> {
    // Any GAME_STATE response (logged in or out) satisfies the request.
    client.cancelGameStateRequest();

    logger.debug('game_state_update', { gameState: gameState.toObject() });

    if (gameState.getState() === ServerMessage.GameState.State.LOGGED_IN) {
      const playerInfo = gameState.getPlayerInfo()!;
      const rsn = playerInfo.getUsername().toLowerCase();
      const playerId = client.getLinkedPlayerId();

      const username = await Players.lookupUsername(playerId);
      if (username === null) {
        client.sendUnauthenticatedAndClose();
        return;
      }

      client.setLoggedInRsn(rsn);

      let clientAccountHash: bigint | null = null;
      const accountHashStr = playerInfo.getAccountHash();

      try {
        if (accountHashStr !== '') {
          // `-1` is what RuneLite reports if it can't access the account hash.
          const hash = BigInt(accountHashStr);
          if (hash !== -1n) {
            clientAccountHash = hash;
          }
        }
      } catch {
        logger.error('invalid_account_hash', {
          playerId,
          username,
          accountHash: accountHashStr,
        });
      }

      const isValid = await this.validatePlayerIdentity(
        playerId,
        clientAccountHash,
        playerInfo.getUsername(), // Non-normalized display name
        username,
      );

      if (isValid) {
        // When a player logs in, request a confirmation of their active
        // challenge state to synchronize with the server.
        await Promise.all([
          this.requestChallengeStateConfirmation(client, rsn),
          Players.updateExperience(rsn, playerInfo.toObject()),
        ]);
      } else {
        const error = new ServerMessage();
        error.setType(ServerMessage.Type.ERROR);
        const rsnError = new ServerMessage.Error();
        rsnError.setType(ServerMessage.Error.Type.USERNAME_MISMATCH);
        rsnError.setUsername(username);
        error.setError(rsnError);
        client.sendMessage(error);
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
        logger.warn('unknown_game_state', { state: gameState.getState() });
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

  /**
   * Validates that the logged-in player matches the player linked to the API
   * key. Uses account hash if available, otherwise falls back to username.
   *
   * On first successful login (when no account hash is stored), the account
   * hash from the client is saved for future validation.
   *
   * @param playerId The ID of the linked player.
   * @param clientAccountHash The account hash sent by the client, or null if
   *     not available.
   * @param clientRsn The RSN sent by the client.
   * @param storedUsername The username stored for the player.
   * @returns True if the player identity is valid.
   */
  private async validatePlayerIdentity(
    playerId: number,
    clientAccountHash: bigint | null,
    clientRsn: string,
    storedUsername: string,
  ): Promise<boolean> {
    const storedAccountHash = await Players.getAccountHash(playerId);
    const displayNameMatches =
      clientRsn.toLowerCase() === storedUsername.toLowerCase();

    if (storedAccountHash !== null) {
      // Account hash is stored; use it for validation.
      if (clientAccountHash === null) {
        // Client didn't send an account hash but we have one stored.
        // Fall back to username validation for backwards compatibility.
        logger.info('client_missing_account_hash', { playerId, clientRsn });
        return displayNameMatches;
      }

      const isValid = clientAccountHash === storedAccountHash;
      if (!isValid) {
        logger.warn('account_hash_mismatch', {
          playerId,
          clientAccountHash: clientAccountHash.toString(),
          storedAccountHash: storedAccountHash.toString(),
        });
      } else if (!displayNameMatches) {
        // Hash matches but RSN differs: auto-queue name change.
        logger.info('auto_name_change_queued', {
          reason: 'hash_match_rsn_differs',
          oldName: storedUsername,
          newName: clientRsn,
          existingPlayerId: playerId,
          newPlayerId: playerId,
        });
        await Players.queueNameChange(storedUsername, clientRsn, playerId);
      }
      return isValid;
    }

    // No account hash stored yet. Validate by username.
    if (!displayNameMatches) {
      logger.info('username_mismatch_no_hash', {
        playerId,
        clientRsn,
        storedUsername,
      });
      return false;
    }

    // First successful login with this API key. Store the account hash if
    // the client provided one.
    if (clientAccountHash !== null) {
      logger.info('account_hash_stored', {
        playerId,
        accountHash: clientAccountHash.toString(),
      });
      try {
        await Players.setAccountHash(playerId, clientAccountHash);
      } catch (e) {
        if (isPostgresUniqueViolation(e)) {
          // The account hash already belongs to another player: this is a name
          // change. Find the player who has this hash and queue a name change
          // from their username to the client's RSN.
          const existingPlayer =
            await Players.getPlayerByAccountHash(clientAccountHash);
          if (existingPlayer !== null) {
            logger.info('auto_name_change_queued', {
              reason: 'account_hash_already_exists',
              oldName: existingPlayer.username,
              newName: clientRsn,
              existingPlayerId: existingPlayer.id,
              newPlayerId: playerId,
            });
            await Players.queueNameChange(
              existingPlayer.username,
              clientRsn,
              existingPlayer.id,
            );
          }
        } else {
          // We've already passed validation at this point. Don't take action in
          // response to the error, just log it.
          logger.error('database_error', {
            operation: 'set_account_hash',
            playerId,
            accountHash: clientAccountHash.toString(),
            error: e instanceof Error ? e : new Error(String(e)),
          });
        }
      }
    }

    return true;
  }
}
