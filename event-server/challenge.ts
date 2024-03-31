import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  PlayerInfo,
  PrimaryMeleeGear,
  RaidDocument,
  RaidModel,
  RecordedChallengeModel,
  RecordingType,
  Stage,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';
import { Types } from 'mongoose';

import Client from './client';
import { Players } from './players';

export function challengePartyKey(partyMembers: string[]) {
  return partyMembers
    .map((name) => name.toLowerCase().replace(' ', '_'))
    .join('-');
}

type PlayerInfoWithoutUsername = Omit<PlayerInfo, 'currentUsername'>;

const BLORVA_PLATEBODY_ID = 28256;
const TORVA_PLATEBODY_ID = 26384;
const BANDOS_CHESTPLATE_ID = 11832;
const VOID_MELEE_HELM_ID = 11665;
const VOID_MELEE_HELM_OR_ID = 26477;

enum State {
  STARTING,
  IN_PROGRESS,
  ENDING,
}

export abstract class Challenge {
  private readonly type: ChallengeType;
  private readonly id: string;
  private readonly party: string[];
  private readonly partyKey: string;
  private readonly startTime: number;

  private clients: Client[];

  private state: State;
  private challengeStatus: ChallengeStatus;
  private mode: ChallengeMode;
  private partyInfo: PlayerInfoWithoutUsername[];
  private playerGearSet: Set<string>;

  private stage: Stage;
  private overallTicks: number;

  constructor(
    type: ChallengeType,
    id: string,
    mode: ChallengeMode,
    party: string[],
    startTime: number,
    initialStage: Stage,
  ) {
    this.type = type;
    this.id = id;
    this.party = party;
    this.partyKey = challengePartyKey(party);
    this.startTime = startTime;

    this.clients = [];

    this.state = State.STARTING;
    this.challengeStatus = ChallengeStatus.IN_PROGRESS;
    this.mode = mode;
    this.partyInfo = party.map((_) => ({ gear: PrimaryMeleeGear.BLORVA }));
    this.playerGearSet = new Set();

    this.stage = initialStage;
    this.overallTicks = 0;
  }

  /**
   * @returns The ID of the challenge.
   */
  public getId(): string {
    return this.id;
  }

  /**
   * @returns The usernames of the members in the challenge party.
   */
  public getParty(): string[] {
    return this.party;
  }

  /**
   * @returns A unique identifier for the challenge party.
   */
  public getPartyKey(): string {
    return this.partyKey;
  }

  public getScale(): number {
    return this.party.length;
  }

  public getStartTime(): number {
    return this.startTime;
  }

  public hasClients(): boolean {
    return this.clients.length > 0;
  }

  public getChallengeStatus(): ChallengeStatus {
    return this.challengeStatus;
  }

  /**
   * @returns True if the challenge has been initialized but has not yet started.
   */
  protected isStarting(): boolean {
    return this.state === State.STARTING;
  }

  protected setChallengeStatus(status: ChallengeStatus): void {
    this.challengeStatus = status;
  }

  public getMode(): ChallengeMode {
    return this.mode;
  }

  /**
   * @returns The current stage of the challenge.
   */
  public getStage(): Stage {
    return this.stage;
  }

  protected setStage(stage: Stage): void {
    this.stage = stage;
  }

  public getOverallTime(): number {
    return this.overallTicks;
  }

  public setOverallTime(time: number): void {
    this.overallTicks = time;
  }

  protected getPartyInfo(): PlayerInfoWithoutUsername[] {
    return this.partyInfo;
  }

  /**
   * Called when the challenge is first initialized, with the database document
   * which will be created. Implementations should populate any specific fields
   * they require.
   *
   * @param document The challenge document, with core fields already set.
   */
  protected abstract onInitialize(document: RaidDocument): Promise<void>;
  protected abstract onFinish(): Promise<void>;
  protected abstract processChallengeEvent(event: Event): Promise<void>;

  /**
   * Adds a new client as an event source for the raid.
   * @param client The client.
   * @param spectator Whether the client is spectating the raid.
   * @returns `true` if the client was added, `false` if not.
   */
  public async registerClient(
    client: Client,
    spectator: boolean,
  ): Promise<boolean> {
    if (client.getActiveChallenge() !== null) {
      console.error(
        `Client ${client.getSessionId()} attempted to join ${this.id}, but is already in a raid`,
      );
      return false;
    }

    if (this.clients.find((c) => c == client) !== undefined) {
      return false;
    }

    this.clients.push(client);
    client.setActiveChallenge(this);

    const recordedChallenge = new RecordedChallengeModel({
      recorderId: client.getUserId(),
      cId: this.getId(),
      recordingType: spectator ? RecordingType.SPECTATOR : RecordingType.RAIDER,
    });
    await recordedChallenge.save();

    return true;
  }

  /**
   * Removes a client from being an event source for the raid.
   * @param client The client.
   */
  public removeClient(client: Client): void {
    if (client.getActiveChallenge() == this) {
      this.clients = this.clients.filter((c) => c != client);
      client.setActiveChallenge(null);
    } else {
      console.error(
        `Client ${client.getSessionId()} tried to leave raid ${this.getId()}, but was not in it`,
      );
    }
  }

  public async initialize(): Promise<void> {
    const record = new RaidModel({
      _id: this.id,
      type: this.type,
      mode: this.mode,
      stage: this.stage,
      status: this.challengeStatus,
      party: this.party,
      partyInfo: this.partyInfo,
      startTime: this.startTime,
      totalTicks: 0,
    });
    await this.onInitialize(record);
    await record.save();
  }

  /**
   * Completes the challenge, finalizing its recorded state.
   */
  public async finish(): Promise<void> {
    if (this.isStarting()) {
      console.log(
        `Challenge ${this.id} closed before starting; deleting record`,
      );
      await Promise.all([
        RaidModel.deleteOne({ _id: this.id }),
        RecordedChallengeModel.deleteMany({ cId: this.id }),
      ]);
      return;
    }

    let promises: Promise<void>[] = [];

    promises.push(
      this.updateDatabaseFields((record) => {
        record.status = this.getChallengeStatus();
      }),
    );

    promises.push(this.onFinish());

    await Promise.all(promises);
  }

  /**
   * Updates the mode of the challenge.
   * @param mode The new mode.
   */
  public async setMode(mode: ChallengeMode): Promise<void> {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    await this.updateDatabaseFields((record) => {
      record.mode = this.mode;
    });
  }

  public async processEvent(event: Event): Promise<void> {
    await this.processChallengeEvent(event);
  }

  protected async start(): Promise<void> {
    const promises = this.getParty().map(Players.startNewRaid);
    const playerIds = await Promise.all(promises);

    if (playerIds.some((id) => id === null)) {
      console.error(
        `Raid ${this.getId()} failed to start; could not find or create all players`,
      );
      this.finish();
      return;
    }

    await this.updateDatabaseFields((record) => {
      record.partyIds = playerIds as Types.ObjectId[];
    });

    this.state = State.IN_PROGRESS;
  }

  protected async updateDatabaseFields(
    updateCallback: (document: RaidDocument) => void,
  ) {
    const record = await RaidModel.findOne({ _id: this.getId() });
    if (record !== null) {
      updateCallback(record);
      record.save();
    }
  }

  protected tryDetermineGear(player: Event.Player): void {
    if (this.playerGearSet.has(player.getName())) {
      return;
    }

    const equipment = player.getEquipmentList();
    if (equipment.length === 0) {
      return;
    }

    const torso = equipment.find(
      (item) => item.getSlot() === Event.Player.EquipmentSlot.TORSO,
    );
    const helm = equipment.find(
      (item) => item.getSlot() === Event.Player.EquipmentSlot.HEAD,
    );
    let gear: PrimaryMeleeGear | null = null;

    if (torso !== undefined) {
      switch (torso.getId()) {
        case BLORVA_PLATEBODY_ID:
          gear = PrimaryMeleeGear.BLORVA;
          break;
        case TORVA_PLATEBODY_ID:
          gear = PrimaryMeleeGear.TORVA;
          break;
        case BANDOS_CHESTPLATE_ID:
          gear = PrimaryMeleeGear.BANDOS;
          break;
      }
    }
    if (
      helm !== undefined &&
      (helm.getId() === VOID_MELEE_HELM_ID ||
        helm.getId() === VOID_MELEE_HELM_OR_ID)
    ) {
      gear = PrimaryMeleeGear.ELITE_VOID;
    }

    if (gear !== null) {
      this.partyInfo[this.getParty().indexOf(player.getName())].gear = gear;
      this.playerGearSet.add(player.getName());
    }
  }
}
