import {
  Event,
  EventType,
  RaidStartEvent,
  RaidUpdateEvent,
} from '@blert/common';

import Client from './client';
import RaidManager from './raid-manager';
import {
  RaidEventsMessage,
  RaidStartResponseMessage,
  ServerMessage,
  ServerMessageType,
} from './server-message';

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

export default class MessageHandler {
  private raidManager: RaidManager;
  private eventAggregators: { [raidId: string]: EventAggregator };

  public constructor(raidManager: RaidManager) {
    this.raidManager = raidManager;
    this.eventAggregators = {};
  }

  public async handleMessage(
    client: Client,
    message: ServerMessage,
  ): Promise<void> {
    switch (message.type) {
      case ServerMessageType.RAID_EVENTS:
        const raidEventsMessage = message as RaidEventsMessage;
        if (Array.isArray(raidEventsMessage.events)) {
          for (const event of raidEventsMessage.events) {
            await this.handleRaidEvent(client, event);
          }
        } else {
          await this.handleRaidEvent(client, raidEventsMessage.events);
        }
        break;

      default:
        console.error(`Unknown message type: ${message.type}`);
        break;
    }
  }

  public async handleRaidEvent(client: Client, event: Event): Promise<void> {
    switch (event.type) {
      case EventType.RAID_START:
        const raidStartEvent = event as RaidStartEvent;

        const raidId = await this.raidManager.startOrJoinRaid(
          client,
          raidStartEvent.raidInfo.mode || null,
          raidStartEvent.raidInfo.party,
        );

        this.eventAggregators[raidId] = new EventAggregator(async (evt) => {
          const raid = this.raidManager.getRaid(raidId);
          if (raid) {
            await raid.processEvent(evt);
          }
        });

        const response: RaidStartResponseMessage = {
          type: ServerMessageType.RAID_START_RESPONSE,
          raidId,
        };
        client.sendMessage(response);
        break;

      case EventType.RAID_END:
        if (event.raidId) {
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
