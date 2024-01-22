import { Event, EventType, RaidStartEvent } from '@blert/common';

import Client from './client';
import RaidManager from './raid-manager';

export default class EventHandler {
  private raidManager: RaidManager;

  public constructor(raidManager: RaidManager) {
    this.raidManager = raidManager;
  }

  public handleEvent(client: Client, event: Event) {
    switch (event.type) {
      case EventType.RAID_START:
        const raidStartEvent = event as RaidStartEvent;

        const raidId = this.raidManager.startOrJoinRaid(
          client,
          raidStartEvent.raidInfo.party,
        );

        // TODO(frolv): Temporary. Server messages need to be standardized.
        client.sendMessage({ type: 'RAID_START_RESPONSE', raidId });
        break;

      case EventType.RAID_END:
        if (event.raidId) {
          this.raidManager.leaveRaid(client, event.raidId);
        }
        break;
    }
  }
}
