import {
  Event,
  EventType,
  RaidStartEvent,
  RaidUpdateEvent,
} from '@blert/common';

import Client from './client';
import RaidManager from './raid-manager';

type EventSink = (event: Event) => void;

/**
 * An event aggregator collects events coming from different sources and merges
 * them into a single source of truth.
 */
class EventAggregator {
  private sink: EventSink;

  public constructor(sink: EventSink) {
    this.sink = sink;
  }

  public process(event: Event): void {
    // TODO(frolv): Just send directly to the sink for now.
    this.sink(event);
  }
}

export default class EventHandler {
  private raidManager: RaidManager;
  private eventAggregators: { [raidId: string]: EventAggregator };

  public constructor(raidManager: RaidManager) {
    this.raidManager = raidManager;
    this.eventAggregators = {};
  }

  public handleEvent(client: Client, event: Event) {
    switch (event.type) {
      case EventType.RAID_START:
        const raidStartEvent = event as RaidStartEvent;

        const raidId = this.raidManager.startOrJoinRaid(
          client,
          raidStartEvent.raidInfo.mode || null,
          raidStartEvent.raidInfo.party,
        );

        this.eventAggregators[raidId] = new EventAggregator((evt) =>
          this.raidManager.getRaid(raidId)?.processEvent(evt),
        );

        // TODO(frolv): Temporary. Server messages need to be standardized.
        client.sendMessage({ type: 'RAID_START_RESPONSE', raidId });
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
            raid.setMode(raidUpdateEvent.raidInfo.mode);
          } else {
            console.error(
              `Received ${event.type} event for nonexistent raid ${event.raidId}`,
            );
          }
        }

      default:
        if (event.raidId) {
          this.eventAggregators[event.raidId].process(event);
        }
    }
  }
}
