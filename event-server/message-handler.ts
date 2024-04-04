import { ChallengeType } from '@blert/common';
import {
  ChallengeMap,
  ChallengeModeMap,
  Event,
  StageMap,
} from '@blert/common/generated/event_pb';
import { ServerMessage } from '@blert/common/generated/server_message_pb';

import Client from './client';
import ChallengeManager from './challenge-manager';
import { Users } from './users';

type EventSink = (event: Event) => Promise<void>;

type Proto<E> = E[keyof E];

/**
 * An event aggregator collects events coming from different sources and merges
 * them into a single source of truth.
 */
class EventAggregator {
  private sink: EventSink;

  public constructor(sink: EventSink) {
    this.sink = sink;
  }

  public async process(event: Event): Promise<void> {
    // TODO(frolv): Just send directly to the sink for now.
    await this.sink(event);
  }
}

export default class MessageHandler {
  private challengeManager: ChallengeManager;
  private eventAggregators: { [raidId: string]: EventAggregator };

  public constructor(raidManager: ChallengeManager) {
    this.challengeManager = raidManager;
    this.eventAggregators = {};
  }

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

      case ServerMessage.Type.EVENT_STREAM:
        const events = message
          .getChallengeEventsList()
          .sort((a, b) => a.getTick() - b.getTick());
        for (const event of events) {
          await this.handleRaidEvent(client, event);
        }
        break;

      default:
        console.error(`Unknown message type: ${message.getType()}`);
        break;
    }
  }

  public async handleRaidEvent(client: Client, event: Event): Promise<void> {
    switch (event.getType()) {
      case Event.Type.CHALLENGE_START:
        await this.handleChallengeStart(client, event);
        break;

      case Event.Type.CHALLENGE_END:
        if (event.getChallengeId() !== '') {
          const completed = event.getCompletedChallenge()!;
          // TODO(frolv): Handle this elsewhere...
          if (completed.getOverallTimeTicks() !== -1) {
            const challenge = this.challengeManager.get(event.getChallengeId());
            if (challenge) {
              challenge.setOverallTime(completed.getOverallTimeTicks());
            }
          }

          this.challengeManager.leaveChallenge(client, event.getChallengeId());

          // TODO(frolv): This deletion should only occur when the raid is
          // actually finished, but we only have one active client right now.
          delete this.eventAggregators[event.getChallengeId()];
        }
        break;

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
            `Client ${client.getSessionId()} sent event for challenge ` +
              `${event.getChallengeId()}, but is not in it.`,
          );
          return;
        }

        const aggregator = this.eventAggregators[event.getChallengeId()];
        if (aggregator) {
          await aggregator.process(event);
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
    const challengeInfo = event.getChallengeInfo()!;

    const challenge = challengeInfo.getChallenge();
    const partySize = challengeInfo.getPartyList().length;

    const checkPartySize = (minSize: number, maxSize?: number): boolean => {
      maxSize = maxSize ?? minSize;
      if (partySize < minSize || partySize > maxSize) {
        console.error(
          `Received CHALLENGE_START event for ${challenge} with invalid party size: ${partySize}`,
        );

        // TODO(frolv): Use a proper error type instead of an empty ID.
        response.setType(ServerMessage.Type.ACTIVE_CHALLENGE_INFO);
        client.sendMessage(response);
        return false;
      }
      return true;
    };

    switch (challenge) {
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
          `Received CHALLENGE_START event for unimplemented challenge: ${challenge}`,
        );

        // TODO(frolv): Use a proper error type instead of an empty ID.
        response.setType(ServerMessage.Type.ACTIVE_CHALLENGE_INFO);
        client.sendMessage(response);
        return;

      default:
        console.error(
          `Received CHALLENGE_START event with unknown challenge: ${challenge}`,
        );

        // TODO(frolv): Use a proper error type instead of an empty ID.
        response.setType(ServerMessage.Type.ACTIVE_CHALLENGE_INFO);
        client.sendMessage(response);
        return;
    }

    const challengeId = await this.challengeManager.startOrJoin(
      client,
      challenge,
      challengeInfo.getMode(),
      challengeInfo.getPartyList(),
      challengeInfo.getSpectator(),
    );

    this.eventAggregators[challengeId] = new EventAggregator(async (evt) => {
      const challenge = this.challengeManager.get(challengeId);
      if (challenge) {
        await challenge.processEvent(evt);
      }
    });

    response.setType(ServerMessage.Type.ACTIVE_CHALLENGE_INFO);
    response.setActiveChallengeId(challengeId);
    client.sendMessage(response);
  }
}
