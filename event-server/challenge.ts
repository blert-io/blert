import {
  Challenge as ApiChallenge,
  CamelToSnakeCase,
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  DataRepository,
  EventType,
  ItemDelta,
  MaidenCrab,
  Nylo,
  PlayerStats,
  PrimaryMeleeGear,
  QueryableEventField,
  QueryableEventRow,
  RoomNpc,
  RoomNpcType,
  SkillLevel,
  SplitType,
  Stage,
  StageStatus,
  VerzikCrab,
  adjustSplitForMode,
  camelToSnakeObject,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';
import postgres from 'postgres';

import sql from './db';
import { Players } from './players';

export function challengePartyKey(type: ChallengeType, partyMembers: string[]) {
  const sorted = [...partyMembers].sort();
  const party = sorted
    .map((name) => name.toLowerCase().replace(' ', '_'))
    .join('-');
  return `${type}-${party}`;
}

type ModifiableChallengeFields = Pick<
  ApiChallenge,
  | 'status'
  | 'stage'
  | 'mode'
  | 'challengeTicks'
  | 'overallTicks'
  | 'totalDeaths'
>;

type PersonalBest = {
  playerId: number;
  challengeSplitId: number;
};
type ChallengeSplit = {
  type: SplitType;
  ticks: number;
  scale: number;
  accurate: boolean;
};
type ChallengeSplitWithId = ChallengeSplit & { id: number };

const BLORVA_PLATEBODY_ID = 28256;
const TORVA_PLATEBODY_ID = 26384;
const BANDOS_CHESTPLATE_ID = 11832;
const VOID_MELEE_HELM_ID = 11665;
const VOID_MELEE_HELM_OR_ID = 26477;

type PlayerState = {
  playerId: number;
  gear: PrimaryMeleeGear;
  statsUpdates: Partial<PlayerStats>;
  hasCompleted: boolean;
};

enum State {
  STARTING,
  IN_PROGRESS,
  ENDING,
}

export abstract class Challenge {
  private readonly dataRepository: DataRepository;
  private readonly type: ChallengeType;
  private readonly id: string;
  private readonly party: string[];
  private readonly partyKey: string;
  private readonly startTime: number;
  private readonly initialStage: Stage;

  private databaseId: number;
  private players: PlayerState[];
  private state: State;
  private challengeStatus: ChallengeStatus;
  private mode: ChallengeMode;
  private allStagesAccurate: boolean;
  private totalStageTicks: number;
  private totalDeaths: number;
  private overallTicks: number;

  private stage: Stage;
  private stageStatus: StageStatus;
  private stageTick: number;
  private stageNpcs: Map<string, RoomNpc>;
  private stageDeaths: string[];
  private stageTimeInaccurate: boolean;
  private splits: Map<SplitType, number>;
  private stageEventsByTick: Event[][];

  constructor(
    dataRepository: DataRepository,
    type: ChallengeType,
    id: string,
    mode: ChallengeMode,
    party: string[],
    startTime: number,
    initialStage: Stage,
  ) {
    this.dataRepository = dataRepository;
    this.type = type;
    this.id = id;
    this.party = party;
    this.partyKey = challengePartyKey(type, party);
    this.startTime = startTime;
    this.initialStage = initialStage;

    this.databaseId = 0;
    this.players = this.party.map((_) => ({
      playerId: 0,
      gear: PrimaryMeleeGear.UNKNOWN,
      statsUpdates: {},
      hasCompleted: false,
    }));
    this.state = State.STARTING;
    this.challengeStatus = ChallengeStatus.IN_PROGRESS;
    this.mode = mode;
    this.allStagesAccurate = true;
    this.totalStageTicks = 0;
    this.totalDeaths = 0;
    this.overallTicks = 0;

    this.stage = initialStage;
    this.stageStatus = StageStatus.ENTERED;
    this.stageTick = 0;
    this.stageNpcs = new Map();
    this.stageDeaths = [];
    this.stageTimeInaccurate = false;
    this.splits = new Map();
    this.stageEventsByTick = [];
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

  public getDatabaseId(): number {
    return this.databaseId;
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
    const playerIndex = this.party.findIndex(
      (name) => name.toLowerCase() === player.toLowerCase(),
    );
    return playerIndex === -1 ? false : this.players[playerIndex].hasCompleted;
  }

  public markPlayerCompleted(player: string): void {
    const playerIndex = this.party.findIndex(
      (name) => name.toLowerCase() === player.toLowerCase(),
    );
    if (playerIndex !== -1) {
      this.players[playerIndex].hasCompleted = true;
    }
  }

  public markStageTimeInaccurate(): void {
    this.stageTimeInaccurate = true;
  }

  protected getStageTick(): number {
    return this.stageTick;
  }

  protected getStageNpcs(): Map<string, RoomNpc> {
    return this.stageNpcs;
  }

  protected getStageDeaths(): string[] {
    return this.stageDeaths;
  }

  protected setSplit(type: SplitType, ticks: number): void {
    if (ticks > 0) {
      this.splits.set(type, ticks);
    }
  }

  protected getSplit(type: SplitType): number | undefined {
    return this.splits.get(type);
  }

  protected getDataRepository(): DataRepository {
    return this.dataRepository;
  }

  /**
   * Returns the stats for a player set during the challenge's current stage.
   * @param player Username of the player.
   * @returns The stats set for the player so far.
   */
  protected getCurrentStageStats(player: string): PlayerStats {
    const playerIndex = this.party.findIndex(
      (name) => name.toLowerCase() === player.toLowerCase(),
    );

    const defaultZero = {
      get: (obj: any, prop: string) => (prop in obj ? obj[prop] : 0),
    };

    if (playerIndex === -1) {
      return new Proxy({}, defaultZero);
    }

    return new Proxy(this.players[playerIndex].statsUpdates, defaultZero);
  }

  /**
   * Called when the challenge is first initialized.
   *
   * Should write core challenge data files and set up any necessary state.
   */
  protected abstract onInitialize(): Promise<void>;

  /**
   * Called when the challenge is finished.
   *
   * Should perform any necessary cleanup and data finalization.
   * Additionally, challenge and overall time splits should be set.
   */
  protected abstract onFinish(): Promise<void>;

  /**
   * Handles an event occurring during a challenge.
   *
   * @param event The event.
   *
   * @returns `true` if the event data should be saved, `false` if not.
   */
  protected abstract processChallengeEvent(event: Event): Promise<boolean>;

  /**
   * Called when a new stage is entered. Should reset any stage-specific data.
   */
  protected abstract onStageEntered(): Promise<void>;

  /**
   * @returns `true` if every stage of the challenge has been completed.
   */
  protected abstract hasFullyCompletedChallenge(): boolean;

  protected abstract onStageFinished(
    event: Event,
    stageUpdate: Event.StageUpdate,
  ): Promise<void>;

  public async initialize(): Promise<void> {
    const playerIds = await Promise.all(
      this.getParty().map(Players.startChallenge),
    );
    if (playerIds.length !== this.party.length) {
      throw new Error('Failed to find all player IDs');
    }

    playerIds.forEach((id, i) => {
      if (id === null) {
        throw new Error(`Failed to find player ID for ${this.party[i]}`);
      }
      this.players[i].playerId = id;
    });

    await this.createChallenge();
    await this.onInitialize();
  }

  /**
   * Completes the challenge, finalizing its recorded state.
   */
  public async finish(): Promise<void> {
    if (this.isStarting()) {
      console.log(
        `Challenge ${this.id} closed before starting; deleting record`,
      );
      await this.deleteChallenge();
      return;
    }

    // Clear the last stage's splits and stats to allow implementations to set
    // any final overall challenge values.
    this.splits.clear();
    this.players.forEach((player) => {
      player.statsUpdates = {};
    });

    await Promise.all([
      this.updateChallenge({ status: this.challengeStatus }),
      this.onFinish(),
    ]);

    const timesAccurate =
      this.hasFullyCompletedChallenge() &&
      this.allStagesAccurate &&
      this.challengeStatus === ChallengeStatus.COMPLETED;
    const overallSplits = await this.createChallengeSplits(timesAccurate);
    if (timesAccurate) {
      await this.updatePersonalBests(overallSplits);
    }

    await this.updateAllPlayersStats();
  }

  /**
   * Prematurely ends the challenge, deleting all recorded data.
   */
  public async terminate(): Promise<void> {
    console.log(`Challenge ${this.id} terminated.`);
    this.stageEventsByTick = [];
    await this.deleteChallenge();
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

    if (mode !== ChallengeMode.NO_MODE) {
      await this.updateChallenge({ mode });
    }
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

      const saveEvent = await this.processChallengeEvent(event);

      if (event.getTick() === this.stageTick) {
        if (saveEvent) {
          this.addStageEvent(event);
        }
      } else if (event.getTick() > this.stageTick) {
        if (saveEvent) {
          this.addStageEvent(event);
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
          this.state = State.IN_PROGRESS;
        }

        await this.updateChallenge({ stage: event.getStage() });

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
        this.resetForNewStage(event.getStage());
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

    if (this.stageTimeInaccurate) {
      this.allStagesAccurate = false;
    }

    await Promise.all([
      this.updateChallenge({
        challengeTicks: this.totalStageTicks,
        totalDeaths: this.totalDeaths,
      }),
      this.onStageFinished(event, stageUpdate),
      this.writeStageEvents(),
    ]);

    const splitsAccurate =
      !this.stageTimeInaccurate &&
      stageUpdate.getStatus() === StageStatus.COMPLETED;

    const createdSplits = await this.createChallengeSplits(splitsAccurate);
    if (splitsAccurate) {
      await this.updatePersonalBests(createdSplits);
    }

    this.updateAllPlayersStats();
  }

  private updateChallengeState(event: Event): void {
    switch (event.getType()) {
      case Event.Type.PLAYER_DEATH:
        this.totalDeaths++;
        this.stageDeaths.push(event.getPlayer()!.getName());
        break;

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

  protected getStageEvents(tick: number): Event[] {
    return this.stageEventsByTick[tick] ?? [];
  }

  private addStageEvent(event: Event): void {
    if (this.stageEventsByTick[this.stageTick] === undefined) {
      this.stageEventsByTick[this.stageTick] = [];
    }
    this.stageEventsByTick[this.stageTick].push(event);
  }

  private async writeStageEvents(): Promise<void> {
    const events = this.stageEventsByTick.reduce(
      (acc, events) => [...acc, ...events],
      [],
    );

    let dbEventsCount = 0;
    if (!this.stageTimeInaccurate) {
      dbEventsCount = await this.writeQueryableEvents(events);
    }

    // `saveProtoStageEvents` modifies the events, so it must be called last.
    await this.dataRepository.saveProtoStageEvents(
      this.id,
      this.stage,
      this.party,
      events,
    );

    console.log(
      `${this.id}: saved ${events.length} total, ${dbEventsCount} ` +
        `queryable events for stage ${this.stage} (accurate=${!this.stageTimeInaccurate})`,
    );
  }

  private resetForNewStage(newStage: Stage): void {
    this.setStage(newStage);
    this.stageTick = 0;
    this.stageNpcs.clear();
    this.stageDeaths = [];
    this.stageTimeInaccurate = false;
    this.splits.clear();
    this.stageEventsByTick = [];
    this.players.forEach((player) => {
      player.statsUpdates = {};
    });
  }

  protected tryDetermineGear(player: Event.Player): void {
    const playerIndex = this.getParty().indexOf(player.getName());
    if (this.players[playerIndex].gear !== PrimaryMeleeGear.UNKNOWN) {
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
      this.players[playerIndex].gear = gear;
      this.updateChallengePlayerGear(this.players[playerIndex].playerId, gear);
    }
  }

  /**
   * Update the stats of every player in the challenge from their current
   * `statsUpdates`, then resets the stats updates.
   */
  private async updateAllPlayersStats() {
    const promises: Array<Promise<void>> = [];

    if (this.mode === ChallengeMode.TOB_ENTRY) {
      return;
    }

    this.players.forEach((player) => {
      if (Object.keys(player.statsUpdates).length > 0) {
        promises.push(
          Players.updateStats(player.playerId, player.statsUpdates),
        );
      }
      player.statsUpdates = {};
    });

    await Promise.all(promises);
  }

  private async createChallenge(): Promise<void> {
    this.databaseId = await sql.begin(async (sql) => {
      const [{ id }] = await sql`
        INSERT INTO challenges (uuid, type, mode, scale, stage, status, start_time)
        VALUES (
          ${this.id},
          ${this.type},
          ${this.mode},
          ${this.party.length},
          ${this.stage},
          ${this.challengeStatus},
          ${this.startTime}
        )
        RETURNING id;
      `;

      const challengePlayers = this.party.map((name, i) => ({
        challenge_id: id,
        player_id: this.players[i].playerId,
        username: name,
        orb: i,
        primary_gear: PrimaryMeleeGear.UNKNOWN,
      }));

      await sql`
        INSERT INTO challenge_players ${sql(
          challengePlayers,
          'challenge_id',
          'player_id',
          'username',
          'orb',
          'primary_gear',
        )}
    `;

      return id;
    });
  }

  private async deleteChallenge(): Promise<void> {
    const [result] = await Promise.all([
      sql`DELETE FROM challenges WHERE id = ${this.databaseId}`,
      this.dataRepository.deleteChallenge(this.id).catch((e) => {
        console.error(`${this.id}: Failed to delete challenge data:`, e);
      }),
    ]);

    if (result.count > 0) {
      await sql`
        UPDATE players
        SET total_recordings = total_recordings - 1
        WHERE lower(username) = ANY(${this.party.map((p) => p.toLowerCase())})
      `;
    }
  }

  protected async updateChallenge(
    updates: Partial<ModifiableChallengeFields>,
  ): Promise<void> {
    const translated = camelToSnakeObject(updates);

    await sql`
      UPDATE challenges SET ${sql(translated)} WHERE id = ${this.databaseId}
    `;
  }

  private async updateChallengePlayerGear(
    playerId: number,
    gear: PrimaryMeleeGear,
  ): Promise<void> {
    await sql`
      UPDATE challenge_players
      SET primary_gear = ${gear}
      WHERE
        challenge_id = ${this.databaseId}
        AND player_id = ${playerId}
    `;
  }

  private async createChallengeSplits(
    accurate: boolean,
  ): Promise<ChallengeSplitWithId[]> {
    if (this.splits.size === 0) {
      return [];
    }

    const splitsToInsert: Array<ChallengeSplit & { challenge_id: number }> = [];

    this.splits.forEach((ticks, split) => {
      splitsToInsert.push({
        challenge_id: this.databaseId,
        type: adjustSplitForMode(split, this.mode),
        scale: this.party.length,
        ticks,
        accurate,
      });
    });

    const ids = await sql`
      INSERT INTO challenge_splits ${sql(
        splitsToInsert,
        'challenge_id',
        'type',
        'scale',
        'ticks',
        'accurate',
      )}
      RETURNING id
    `;

    return splitsToInsert.map((split, i) => ({ ...split, id: ids[i].id }));
  }

  /**
   * Compares the provided splits to the current personal bests for each player
   * in this challenge, updating the personal bests if the new times are better.
   *
   * @param splits Splits to check.
   */
  private async updatePersonalBests(
    splits: ChallengeSplitWithId[],
  ): Promise<void> {
    const currentPbs = await sql`
      SELECT
        challenge_splits.type,
        challenge_splits.ticks,
        personal_bests.challenge_split_id,
        personal_bests.player_id
      FROM personal_bests
      JOIN challenge_splits ON personal_bests.challenge_split_id = challenge_splits.id
      WHERE
        challenge_splits.type = ANY(${splits.map((s) => s.type)})
        AND challenge_splits.scale = ${this.party.length}
        AND personal_bests.player_id = ANY(${this.players.map((p) => p.playerId)})
    `;

    const pbsByPlayer: Map<
      number,
      Map<SplitType, { ticks: number; id: number }>
    > = new Map(this.players.map((p) => [p.playerId, new Map()]));
    currentPbs.forEach((pb) => {
      pbsByPlayer.get(pb.player_id)!.set(pb.type, {
        ticks: pb.ticks,
        id: pb.challenge_split_id,
      });
    });

    const pbRowsToCreate: Array<CamelToSnakeCase<PersonalBest>> = [];

    for (const split of splits) {
      const pbRowsToUpdate: Array<postgres.Helper<number[]>> = [];

      this.players.forEach(({ playerId }, i) => {
        const currentPb = pbsByPlayer.get(playerId)!.get(split.type);

        if (currentPb === undefined) {
          console.log(
            `Setting PB(${split.type}, ${this.party.length}) for ` +
              `${this.party[i]}#${playerId} to ${split.ticks}`,
          );
          pbRowsToCreate.push({
            player_id: playerId,
            challenge_split_id: split.id,
          });
        } else if (split.ticks < currentPb.ticks) {
          console.log(
            `Updating PB(${split.type}, ${this.party.length}) for ` +
              `${this.party[i]}#${playerId} to ${split.ticks}`,
          );
          pbRowsToUpdate.push(sql([playerId, currentPb.id]));
        } else {
          console.log(
            `PB(${split.type}, ${this.party.length}) for ` +
              `${this.party[i]}#${playerId} is already better: ${currentPb.ticks}`,
          );
        }
      });

      if (pbRowsToUpdate.length > 0) {
        await sql`
          UPDATE personal_bests
          SET challenge_split_id = ${split.id}
          WHERE (player_id, challenge_split_id) IN ${sql(pbRowsToUpdate)}
        `;
      }
    }

    if (pbRowsToCreate.length > 0) {
      await sql`
        INSERT INTO personal_bests ${sql(
          pbRowsToCreate,
          'player_id',
          'challenge_split_id',
        )}
      `;
    }
  }

  private async writeQueryableEvents(events: Event[]): Promise<number> {
    const queryableEvents: QueryableEventRow[] = [];

    const baseQueryableEvent = (event: Event): QueryableEventRow => ({
      challenge_id: this.databaseId,
      event_type: event.getType(),
      stage: this.stage,
      mode: this.mode,
      tick: event.getTick(),
      x_coord: event.getXCoord(),
      y_coord: event.getYCoord(),
      subtype: null,
      player_id: null,
      npc_id: null,
      custom_int_1: null,
      custom_int_2: null,
      custom_short_1: null,
      custom_short_2: null,
    });

    for (const event of events) {
      switch (event.getType()) {
        case EventType.PLAYER_ATTACK: {
          const attack = event.getPlayerAttack()!;
          const e = baseQueryableEvent(event);
          e.subtype = attack.getType();
          e.player_id =
            this.players[
              this.party.indexOf(event.getPlayer()!.getName())
            ].playerId;
          e[QueryableEventField.PLAYER_ATTACK_DISTANCE] =
            attack.getDistanceToTarget();
          if (attack.hasTarget()) {
            e.npc_id = attack.getTarget()!.getId();
          }
          if (attack.hasWeapon()) {
            e[QueryableEventField.PLAYER_ATTACK_WEAPON] = attack
              .getWeapon()!
              .getId();
          }
          queryableEvents.push(e);
          break;
        }

        case EventType.PLAYER_DEATH: {
          const e = baseQueryableEvent(event);
          e.player_id =
            this.players[
              this.party.indexOf(event.getPlayer()!.getName())
            ].playerId;
          queryableEvents.push(e);
          break;
        }

        case EventType.NPC_SPAWN:
        case EventType.NPC_DEATH: {
          const e = baseQueryableEvent(event);
          e.npc_id = event.getNpc()!.getId();
          queryableEvents.push(e);
          break;
        }

        case EventType.NPC_ATTACK: {
          const attack = event.getNpcAttack()!;
          const e = baseQueryableEvent(event);
          e.subtype = attack.getAttack();
          e.npc_id = event.getNpc()!.getId();
          if (attack.hasTarget()) {
            e.player_id =
              this.players[this.party.indexOf(attack.getTarget())].playerId;
          }
          queryableEvents.push(e);
          break;
        }

        case EventType.TOB_MAIDEN_CRAB_LEAK: {
          const npc = event.getNpc()!;
          const maidenCrab = (
            this.stageNpcs.get(npc.getRoomId().toString()) as MaidenCrab
          )?.maidenCrab;
          if (maidenCrab === undefined) {
            break;
          }
          const hitpoints = SkillLevel.fromRaw(npc.getHitpoints());

          const e = baseQueryableEvent(event);
          e.npc_id = npc.getId();
          e[QueryableEventField.TOB_MAIDEN_CRAB_LEAK_SPAWN] = maidenCrab.spawn;
          e[QueryableEventField.TOB_MAIDEN_CRAB_LEAK_POSITION] =
            maidenCrab.position;
          e[QueryableEventField.TOB_MAIDEN_CRAB_LEAK_CURRENT_HP] =
            hitpoints.getCurrent();
          e[QueryableEventField.TOB_MAIDEN_CRAB_LEAK_BASE_HP] =
            hitpoints.getBase();
          queryableEvents.push(e);
          break;
        }

        case EventType.TOB_BLOAT_DOWN: {
          const down = event.getBloatDown()!;
          const e = baseQueryableEvent(event);
          e[QueryableEventField.TOB_BLOAT_DOWN_NUMBER] = down.getDownNumber();
          e[QueryableEventField.TOB_BLOAT_DOWN_WALK_TIME] = down.getWalkTime();
          queryableEvents.push(e);
          break;
        }

        case EventType.TOB_NYLO_WAVE_STALL: {
          const wave = event.getNyloWave()!;
          const e = baseQueryableEvent(event);
          e[QueryableEventField.TOB_NYLO_WAVE_NUMBER] = wave.getWave();
          e[QueryableEventField.TOB_NYLO_WAVE_NYLO_COUNT] =
            wave.getNylosAlive();
          queryableEvents.push(e);
          break;
        }
      }
    }

    if (queryableEvents.length > 0) {
      await sql`INSERT INTO queryable_events ${sql(queryableEvents)}`;
    }

    return queryableEvents.length;
  }
}
