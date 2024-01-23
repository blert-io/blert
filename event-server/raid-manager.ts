import { v4 as uuidv4 } from 'uuid';

import Client from './client';
import Raid, { raidPartyKey } from './raid';
import { Mode } from '@blert/common';

export default class RaidManager {
  private raidsById: { [id: string]: Raid };
  private raidsByPartyKey: { [key: string]: Raid };
  private pendingRaids: Raid[];

  /**
   * How long to wait for every client in a raid session to connect following
   * its initial registration with the manager.
   */
  private static RAID_START_WINDOW_MS: number = 10 * 1000;

  constructor() {
    this.raidsById = {};
    this.raidsByPartyKey = {};
    this.pendingRaids = [];

    setInterval(() => this.cleanPendingRaids(), 1000);
  }

  /**
   * Attempts to start a new raid session for the party identified by `partyKey`
   * or joins an existing session pending for the party.
   *
   * @param client The client initiating the raid.
   * @param partyMembers Ordered list of members in the raid party.
   * @returns The ID of the raid session.
   */
  public startOrJoinRaid(
    client: Client,
    mode: Mode | null,
    partyMembers: string[],
  ): string {
    const partyKey = raidPartyKey(partyMembers);

    let raid = this.pendingRaids.find(
      (pending) => pending.getPartyKey() === partyKey,
    );

    if (!raid) {
      const raidId = uuidv4();
      raid = new Raid(raidId, partyMembers, mode, Date.now());

      this.raidsById[raidId] = raid;
      this.raidsByPartyKey[partyKey] = raid;
      this.pendingRaids.push(raid);

      console.log(`Started new raid ${raidId}`);
    } else {
      if (mode != null) {
        raid.setMode(mode);
      }
      console.log(`Found existing raid ${raid.getId()}`);
    }

    raid.registerClient(client);

    return raid.getId();
  }

  /**
   * Ends the participation of a client in a raid. If the client is the last
   * remaining client streaming data for the raid, the raid is considered
   * complete.
   *
   * @param client The client leaving the raid.
   * @param id ID of the raid the client is leaving.
   */
  public leaveRaid(client: Client, id: string): void {
    const raid = this.raidsById[id];
    if (raid === undefined) {
      return;
    }

    raid.removeClient(client);
    if (raid.hasClients()) {
      return;
    }

    if (this.pendingRaids.find((pending) => pending.getId() === id)) {
      // Pending raids should be kept around the end of their joining period.
      return;
    }

    this.endRaid(raid);
  }

  /**
   * Looks up an active raid session by its ID.
   * @param id ID of the raid.
   * @returns The raid if found.
   */
  public getRaid(id: string): Raid | undefined {
    return this.raidsById[id];
  }

  private endRaid(raid: Raid): void {
    raid.finish();

    delete this.raidsById[raid.getId()];
    delete this.raidsByPartyKey[raid.getPartyKey()];

    console.log(`Ended raid ${raid.getId()}`);
  }

  private cleanPendingRaids(): void {
    const cutoff = Date.now() - RaidManager.RAID_START_WINDOW_MS;
    const pendingBefore = this.pendingRaids.length;

    let pendingRaids = [];
    for (const pending of this.pendingRaids) {
      if (pending.getStartTime() >= cutoff) {
        pendingRaids.push(pending);
      } else if (!pending.hasClients()) {
        // No clients connected during the raid's joining period. Delete it.
        this.endRaid(pending);
      }
    }

    this.pendingRaids = pendingRaids;

    const staleRaids = pendingBefore - this.pendingRaids.length;
    if (staleRaids > 0) {
      console.log(`Cleaned ${staleRaids} stale raids`);
    }
  }
}
