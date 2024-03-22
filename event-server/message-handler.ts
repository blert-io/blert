import {
  Event,
  EventType,
  Mode,
  RaidEndEvent,
  RaidStartEvent,
  RaidUpdateEvent,
} from '@blert/common';
import {
  ChallengeMode,
  ChallengeModeMap,
} from '@blert/common/generated/event_pb';
import { ServerMessage } from '@blert/common/generated/server_message_pb';

import Client from './client';
import RaidManager from './raid-manager';
import { Users } from './users';

type EventSink = (event: Event) => Promise<void>;

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

// TODO(frolv): Replace this when enums are updated in the database.
function stringModeToProtoMode(
  mode: Mode,
): ChallengeModeMap[keyof ChallengeModeMap] {
  switch (mode) {
    case Mode.ENTRY:
      return ChallengeMode.TOB_ENTRY;
    case Mode.REGULAR:
      return ChallengeMode.TOB_REGULAR;
    case Mode.HARD:
      return ChallengeMode.TOB_HARD;
  }

  return ChallengeMode.UNKNOWN_MODE;
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
        const history = await Users.getRaidHistory(client.getUserId());

        const historyResponse = new ServerMessage();
        historyResponse.setType(ServerMessage.Type.HISTORY_RESPONSE);

        historyResponse.setRecentRecordingsList(
          history.map((raid) => {
            const pastRaid = new ServerMessage.PastChallenge();
            pastRaid.setId(raid.id);
            pastRaid.setStatus(raid.status);
            pastRaid.setMode(stringModeToProtoMode(raid.mode));
            pastRaid.setPartyList(raid.party);
            return pastRaid;
          }),
        );

        client.sendMessage(historyResponse);
        break;

      case ServerMessage.Type.EVENT_STREAM:
        const events = JSON.parse(message.getSerializedRaidEvents());
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
    switch (event.type) {
      case EventType.RAID_START:
        const raidStartEvent = event as RaidStartEvent;

        const response = new ServerMessage();

        const partySize = raidStartEvent.raidInfo.party.length;
        if (partySize === 0 || partySize > 5) {
          console.error(
            `Received ${event.type} event for raid with invalid party size: ${partySize}`,
          );

          // TODO(frolv): Use a proper error type instead of an empty ID.
          response.setType(ServerMessage.Type.ACTIVE_CHALLENGE_INFO);
          client.sendMessage(response);
          return;
        }

        const raidId = await this.raidManager.startOrJoinRaid(
          client,
          raidStartEvent.raidInfo.mode || null,
          raidStartEvent.raidInfo.party,
          raidStartEvent.raidInfo.isSpectator ?? false,
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

      case EventType.RAID_END:
        if (event.raidId) {
          const completedRaid = (event as RaidEndEvent).completedRaid;
          // TODO(frolv): Handle this elsewhere..
          if (completedRaid.overallTime !== -1) {
            const raid = this.raidManager.getRaid(event.raidId);
            if (raid) {
              raid.setOverallTime(completedRaid.overallTime);
            }
          }

          this.raidManager.leaveRaid(client, event.raidId);

          // TODO(frolv): This deletion should only occur when the raid is
          // actually finished, but we only have one active client right now.
          delete this.eventAggregators[event.raidId];
        }
        break;

      case EventType.RAID_UPDATE:
        const raidUpdateEvent = event as RaidUpdateEvent;
        if (raidUpdateEvent.raidId && raidUpdateEvent.raidInfo.mode) {
          const raid = this.raidManager.getRaid(raidUpdateEvent.raidId);
          if (raid) {
            await raid.setMode(raidUpdateEvent.raidInfo.mode);
          } else {
            console.error(
              `Received ${event.type} event for nonexistent raid ${event.raidId}`,
            );
          }
        }
        break;

      default:
        if (!event.raidId) {
          return;
        }

        const aggregator = this.eventAggregators[event.raidId];
        if (aggregator) {
          await aggregator.process(event);
        } else {
          console.error(`Received event for unknown raid ${event.raidId}`);
        }
    }
  }
}
