import {
  ChallengeModeMap,
  Event,
  StageMap,
} from '@blert/common/generated/event_pb';
import { ServerMessage } from '@blert/common/generated/server_message_pb';

import Client from './client';
import RaidManager from './raid-manager';
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
  private raidManager: RaidManager;
  private eventAggregators: { [raidId: string]: EventAggregator };

  public constructor(raidManager: RaidManager) {
    this.raidManager = raidManager;
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
          history.map((raid) => {
            const pastRaid = new ServerMessage.PastChallenge();
            pastRaid.setId(raid.id);
            pastRaid.setStatus(
              raid.status as Proto<ServerMessage.PastChallenge.StatusMap>,
            );
            pastRaid.setStage(raid.stage as Proto<StageMap>);
            pastRaid.setMode(raid.mode as Proto<ChallengeModeMap>);
            pastRaid.setPartyList(raid.party);
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
        const response = new ServerMessage();

        const challengeInfo = event.getChallengeInfo()!;
        const partySize = challengeInfo.getPartyList().length;
        if (partySize === 0 || partySize > 5) {
          console.error(
            `Received CHALLENGE_START event for with invalid party size: ${partySize}`,
          );

          // TODO(frolv): Use a proper error type instead of an empty ID.
          response.setType(ServerMessage.Type.ACTIVE_CHALLENGE_INFO);
          client.sendMessage(response);
          return;
        }

        const raidId = await this.raidManager.startOrJoinRaid(
          client,
          challengeInfo.getMode(),
          challengeInfo.getPartyList(),
          challengeInfo.getSpectator(),
        );

        this.eventAggregators[raidId] = new EventAggregator(async (evt) => {
          const raid = this.raidManager.getRaid(raidId);
          if (raid) {
            await raid.processEvent(evt);
          }
        });

        response.setType(ServerMessage.Type.ACTIVE_CHALLENGE_INFO);
        response.setActiveChallengeId(raidId);
        client.sendMessage(response);
        break;

      case Event.Type.CHALLENGE_END:
        if (event.getChallengeId() !== '') {
          const challenge = event.getCompletedChallenge()!;
          // TODO(frolv): Handle this elsewhere...
          if (challenge.getOverallTimeTicks() !== -1) {
            const raid = this.raidManager.getRaid(event.getChallengeId());
            if (raid) {
              raid.setOverallTime(challenge.getOverallTimeTicks());
            }
          }

          this.raidManager.leaveRaid(client, event.getChallengeId());

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
          const raid = this.raidManager.getRaid(event.getChallengeId());
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

        if (event.getChallengeId() !== client.getActiveRaid()?.getId()) {
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
}
