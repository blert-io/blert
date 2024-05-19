import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  ItemDelta,
  MaidenCrab,
  Nylo,
  PlayerInfo,
  PrimaryMeleeGear,
  RaidDocument,
  RaidModel,
  RecordedChallengeModel,
  RoomEvent,
  RoomNpc,
  RoomNpcType,
  Stage,
  StageStatus,
  VerzikCrab,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';
import { Types } from 'mongoose';

import { Players } from './players';
import { protoToEvent } from './proto';

export function challengePartyKey(type: ChallengeType, partyMembers: string[]) {
  const sorted = [...partyMembers].sort();
  const party = sorted
    .map((name) => name.toLowerCase().replace(' ', '_'))
    .join('-');
  return `${type}-${party}`;
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
  private readonly initialStage: Stage;

  private state: State;
  private challengeStatus: ChallengeStatus;
  private mode: ChallengeMode;
  private completedPlayers: Set<string>;
  private partyInfo: PlayerInfoWithoutUsername[];
  private playerGearSet: Set<string>;
  private totalStageTicks: number;
  private overallTicks: number;

  private stage: Stage;
  private stageStatus: StageStatus;
  private stageTick: number;
  private stageNpcs: Map<string, RoomNpc>;
  private stageTimeInaccurate: boolean;
  private queuedEvents: Event[];

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
    this.partyKey = challengePartyKey(type, party);
    this.startTime = startTime;
    this.initialStage = initialStage;

    this.state = State.STARTING;
    this.challengeStatus = ChallengeStatus.IN_PROGRESS;
    this.mode = mode;
    this.completedPlayers = new Set();
    this.partyInfo = party.map((_) => ({ gear: PrimaryMeleeGear.BLORVA }));
    this.playerGearSet = new Set();
    this.totalStageTicks = 0;
    this.overallTicks = 0;

    this.stage = initialStage;
    this.stageStatus = StageStatus.ENTERED;
    this.stageTick = 0;
    this.stageNpcs = new Map();
    this.stageTimeInaccurate = false;
    this.queuedEvents = [];
  }

  /**
   * @returns The ID of the challenge.
   */
  public getId(): string {
    return this.id;
  }

  /**
   * @returns Type of the challenge.
   */
  public getType(): ChallengeType {
    return this.type;
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

  public getTotalStageTicks(): number {
    return this.totalStageTicks;
  }

  public getOverallTime(): number {
    return this.overallTicks;
  }

  public setOverallTime(time: number): void {
    this.overallTicks = time;
  }

  public playerHasCompleted(player: string): boolean {
    return this.completedPlayers.has(player.toLowerCase());
  }

  public markPlayerCompleted(player: string): void {
    this.completedPlayers.add(player.toLowerCase());
  }

  public markStageTimeInaccurate(): void {
    this.stageTimeInaccurate = true;
  }

  protected getPartyInfo(): PlayerInfoWithoutUsername[] {
    return this.partyInfo;
  }

  protected getStageTick(): number {
    return this.stageTick;
  }

  protected getStageNpcs(): Map<string, RoomNpc> {
    return this.stageNpcs;
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

  /**
   * Handles an event occurring during a challenge.
   *
   * @param event The event.
   *
   * @returns `true` if the event should be written to the database,
   *   `false` if not.
   */
  protected abstract processChallengeEvent(event: Event): Promise<boolean>;

  /**
   * Called when a new stage is entered. Should reset any stage-specific data.
   */
  protected abstract onStageEntered(): Promise<void>;

  protected abstract onStageFinished(
    event: Event,
    stageUpdate: Event.StageUpdate,
  ): Promise<void>;

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
   * Prematurely ends the challenge, deleting all recorded data.
   */
  public async terminate(): Promise<void> {
    this.queuedEvents = [];

    const promises: Promise<any>[] = [
      RaidModel.deleteOne({ _id: this.id }),
      RecordedChallengeModel.deleteMany({ cId: this.id }),
    ];

    for (let stage = this.initialStage; stage <= this.getStage(); stage++) {
      promises.push(RoomEvent.deleteMany({ cId: this.id, stage }));
    }

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

  protected async start(): Promise<void> {
    const promises = this.getParty().map(Players.startNewRaid);
    const playerIds = await Promise.all(promises);

    if (playerIds.some((id) => id === null)) {
      console.error(
        `Challenge ${this.getId()} failed to start; could not find or create all players`,
      );
      this.finish();
      return;
    }

    await this.updateDatabaseFields((record) => {
      record.partyIds = playerIds as Types.ObjectId[];
    });

    this.state = State.IN_PROGRESS;
  }

  public async processEvent(event: Event): Promise<void> {
    if (event.getType() === Event.Type.STAGE_UPDATE) {
      await this.handleStageUpdate(event);
    } else {
      if (event.getStage() !== this.getStage()) {
        console.error(
          `Challenge ${this.getId()} got event ${event.getType()} for stage ` +
            `${event.getStage()} but is at stage ${this.getStage()}`,
        );
        return;
      }

      this.updateChallengeState(event);

      const writeToDb = await this.processChallengeEvent(event);

      // Batch and flush events once per tick to reduce database writes.
      if (event.getTick() === this.stageTick) {
        if (writeToDb) {
          this.queuedEvents.push(event);
        }
      } else if (event.getTick() > this.stageTick) {
        await this.flushQueuedEvents();
        if (writeToDb) {
          this.queuedEvents.push(event);
        }
        this.stageTick = event.getTick();
      } else {
        console.error(
          `Challenge ${this.getId()} got event ${event.getType()} for tick ` +
            `${event.getTick()} (current=${this.stageTick})`,
        );
      }
    }
  }

  private async handleStageUpdate(event: Event): Promise<void> {
    const stageUpdate = event.getStageUpdate();
    if (event.getStage() === Stage.UNKNOWN || stageUpdate === undefined) {
      return;
    }

    switch (stageUpdate.getStatus()) {
      case StageStatus.STARTED:
        if (this.isStarting()) {
          await this.start();
        }
        await this.updateDatabaseFields((record) => {
          record.stage = event.getStage();
        });
        if (this.stageStatus === StageStatus.ENTERED) {
          // A transition from ENTERED -> STARTED has already reset the stage.
          // Don't clear any data received afterwards, unless the stage is new.
          if (this.getStage() === event.getStage()) {
            break;
          }
        }
      // A transition from any other state to STARTED should fall through
      // and reset all stage data.
      case StageStatus.ENTERED:
        this.setStage(event.getStage());
        this.stageTick = 0;
        this.stageNpcs.clear();
        this.stageTimeInaccurate = false;
        this.queuedEvents = [];
        await this.onStageEntered();
        break;

      case StageStatus.WIPED:
      case StageStatus.COMPLETED:
        if (event.getStage() === this.getStage()) {
          await this.handleStageFinished(event, stageUpdate);
        } else {
          console.error(
            `Challenge ${this.getId()} got status ${stageUpdate.getStatus()} ` +
              `for stage ${event.getStage()} but is at stage ${this.getStage()}`,
          );
        }
        break;
    }

    this.stageStatus = stageUpdate.getStatus();
  }

  private async handleStageFinished(
    event: Event,
    stageUpdate: Event.StageUpdate,
  ): Promise<void> {
    this.totalStageTicks += event.getTick();
    this.stageTimeInaccurate =
      this.stageTimeInaccurate || !stageUpdate.getAccurate();

    const promises: Promise<any>[] = [
      this.updateDatabaseFields((record) => {
        // @ts-ignore: Only partial party information is stored.
        record.partyInfo = this.partyInfo;
        record.totalTicks += event.getTick();
      }),
      this.onStageFinished(event, stageUpdate),
      this.flushQueuedEvents(),
    ];

    if (this.stageTimeInaccurate) {
      promises.push(
        RoomEvent.updateMany(
          { cId: this.getId(), stage: this.getStage() },
          { $set: { acc: false } },
        ),
      );
    }

    await Promise.all(promises);
  }

  private updateChallengeState(event: Event): void {
    switch (event.getType()) {
      case Event.Type.NPC_SPAWN:
        this.handleNpcSpawn(event);
        break;

      case Event.Type.NPC_DEATH:
        let npc = this.stageNpcs.get(event.getNpc()!.getRoomId().toString());
        if (npc !== undefined) {
          npc.deathTick = event.getTick();
          npc.deathPoint = { x: event.getXCoord(), y: event.getYCoord() };
        }
        break;
    }
  }

  /**
   * Creates a `RoomNpc` entry in the NPC map for a newly-spawned NPC.
   *
   * @param event The spawn event.
   */
  private handleNpcSpawn(event: Event): void {
    const npc = event.getNpc();
    if (npc === undefined) {
      return;
    }

    let type = RoomNpcType.BASIC;
    if (npc.hasMaidenCrab()) {
      type = RoomNpcType.MAIDEN_CRAB;
    } else if (npc.hasNylo()) {
      type = RoomNpcType.NYLO;
    } else if (npc.hasVerzikCrab()) {
      type = RoomNpcType.VERZIK_CRAB;
    }

    const npcCommon = {
      type,
      spawnNpcId: npc.getId(),
      roomId: npc.getRoomId(),
      spawnTick: event.getTick(),
      spawnPoint: { x: event.getXCoord(), y: event.getYCoord() },
      deathTick: 0,
      deathPoint: { x: 0, y: 0 },
    };

    const { maidenCrab, nylo, verzikCrab } = npc.toObject();

    if (maidenCrab !== undefined) {
      const crab: MaidenCrab = {
        ...npcCommon,
        type: RoomNpcType.MAIDEN_CRAB,
        maidenCrab,
      };
      this.stageNpcs.set(npc.getRoomId().toString(), crab);
    } else if (nylo !== undefined) {
      const nyloDesc: Nylo = {
        ...npcCommon,
        type: RoomNpcType.NYLO,
        nylo,
      };
      this.stageNpcs.set(npc.getRoomId().toString(), nyloDesc);
    } else if (verzikCrab !== undefined) {
      const crab: VerzikCrab = {
        ...npcCommon,
        type: RoomNpcType.VERZIK_CRAB,
        verzikCrab,
      };
      this.stageNpcs.set(npc.getRoomId().toString(), crab);
    } else {
      this.stageNpcs.set(npc.getRoomId().toString(), npcCommon);
    }
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

  private async flushQueuedEvents(): Promise<void> {
    if (this.queuedEvents.length > 0) {
      RoomEvent.insertMany(this.queuedEvents.map(protoToEvent));
    }
    this.queuedEvents = [];
  }

  protected tryDetermineGear(player: Event.Player): void {
    if (this.playerGearSet.has(player.getName())) {
      return;
    }

    const equipment = player.getEquipmentDeltasList().map(ItemDelta.fromRaw);
    if (equipment.length === 0) {
      return;
    }

    const torso = equipment.find(
      (delta) =>
        delta.isAdded() && delta.getSlot() === Event.Player.EquipmentSlot.TORSO,
    );
    const helm = equipment.find(
      (delta) =>
        delta.isAdded() && delta.getSlot() === Event.Player.EquipmentSlot.HEAD,
    );
    let gear: PrimaryMeleeGear | null = null;

    if (torso !== undefined) {
      switch (torso.getItemId()) {
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
      (helm.getItemId() === VOID_MELEE_HELM_ID ||
        helm.getItemId() === VOID_MELEE_HELM_OR_ID)
    ) {
      gear = PrimaryMeleeGear.ELITE_VOID;
    }

    if (gear !== null) {
      this.partyInfo[this.getParty().indexOf(player.getName())].gear = gear;
      this.playerGearSet.add(player.getName());
    }
  }
}
