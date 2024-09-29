import {
  Challenge as ApiChallenge,
  CamelToSnakeCase,
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  DataRepository,
  PrimaryMeleeGear,
  RecordingType,
  RoomNpc,
  SplitType,
  Stage,
  StageStatus,
  adjustSplitForMode,
  camelToSnakeObject,
} from '@blert/common';
import postgres from 'postgres';

import sql from '../db';
import logger from '../log';
import { Players } from '../players';
import { MergedEvents } from '../merge';

export type InitializedFields = {
  totalDeaths?: number;
  challengeStatus?: ChallengeStatus;
  totalChallengeTicks?: number;
  reportedTimes?: ReportedTimes | null;
  customData?: object | null;
};

type ModifiableChallengeFields = Pick<
  ApiChallenge,
  'challengeTicks' | 'mode' | 'stage' | 'status' | 'totalDeaths'
>;

type CustomData = {
  customData: object | null;
};

export type ChallengeState = ModifiableChallengeFields &
  CustomData & {
    uuid: string;
    type: ChallengeType;
    party: string[];
    stageStatus: StageStatus;
    reportedChallengeTicks: number | null;
    reportedOverallTicks: number | null;
  };

export type ReportedTimes = {
  challenge: number;
  overall: number;
};

type DatabaseIds = {
  challenge: number;
  players: number[];
};

type ChallengeSplit = {
  type: SplitType;
  ticks: number;
  scale: number;
  accurate: boolean;
};
type ChallengeSplitWithId = ChallengeSplit & { id: number };

type PersonalBest = {
  playerId: number;
  challengeSplitId: number;
};

type StageState = {
  deaths: string[];
  npcs: Map<string, RoomNpc>;
};

export default abstract class ChallengeProcessor {
  private readonly dataRepository: DataRepository;
  private readonly firstStage: Stage;
  private readonly lastStage: Stage;

  private readonly uuid: string;
  private readonly type: ChallengeType;
  private mode: ChallengeMode;
  private challengeStatus: ChallengeStatus;
  private stage: Stage;
  private stageStatus: StageStatus;
  private party: string[];
  private totalChallengeTicks: number;
  private totalDeaths: number;
  private reportedTimes: ReportedTimes | null;

  private splits: Map<SplitType, number>;
  private stageState: StageState | null;

  private databaseIds: DatabaseIds | null;
  private updates: Partial<ModifiableChallengeFields>;

  /** Returns the challenge's UUID. */
  public getUuid(): string {
    return this.uuid;
  }

  public getState(): ChallengeState {
    return {
      uuid: this.uuid,
      type: this.type,
      mode: this.mode,
      stage: this.stage,
      status: this.challengeStatus,
      stageStatus: this.stageStatus,
      party: this.party,
      challengeTicks: this.totalChallengeTicks,
      totalDeaths: this.totalDeaths,
      reportedChallengeTicks: this.reportedTimes?.challenge ?? null,
      reportedOverallTicks: this.reportedTimes?.overall ?? null,
      customData: this.getCustomData(),
    };
  }

  public setMode(mode: ChallengeMode): void {
    if (mode !== this.mode) {
      this.mode = mode;
      this.updates.mode = mode;
    }
  }

  public setStage(stage: Stage): void {
    if (stage !== this.stage) {
      this.stage = stage;
      this.updates.stage = stage;
    }
  }

  protected addPlayerDeath(player: string): void {
    if (this.stageState !== null) {
      this.totalDeaths += 1;
      this.updates.totalDeaths = this.totalDeaths;
      this.stageState.deaths.push(player);
    }
  }

  protected setTotalChallengeTicks(ticks: number): void {
    if (ticks !== this.totalChallengeTicks) {
      this.totalChallengeTicks = ticks;
      this.updates.challengeTicks = ticks;
    }
  }

  public setReportedTimes(times: ReportedTimes): void {
    this.reportedTimes = times;
  }

  public async createNew(startTime: Date): Promise<void> {
    const playerIds = await Promise.all(this.party.map(Players.startChallenge));
    if (
      playerIds.length !== this.party.length ||
      playerIds.some((id) => id === null)
    ) {
      throw new Error('Failed to find all player IDs');
    }

    await this.createChallenge(startTime, playerIds as number[]);
  }

  public async finish(): Promise<void> {
    await this.loadIds();

    if (this.totalChallengeTicks === 0) {
      logger.info(
        `Challenge ${this.uuid} ended without any data; deleting record`,
      );
      await this.deleteChallenge();
      return;
    }

    if (this.stageStatus === StageStatus.STARTED) {
      logger.info(
        `Challenge ${this.uuid} finished with stage still in progress`,
      );
      this.challengeStatus = ChallengeStatus.ABANDONED;
    }

    if (
      this.reportedTimes !== null &&
      this.reportedTimes.challenge !== this.totalChallengeTicks
    ) {
      logger.warn(
        `Challenge time mismatch: recorded ${this.totalChallengeTicks}, ` +
          `reported ${this.reportedTimes.challenge}`,
      );
      this.totalChallengeTicks = this.reportedTimes.challenge;
    }

    await Promise.all([
      this.updateChallenge({
        status: this.challengeStatus,
        challengeTicks: this.totalChallengeTicks,
      }),
      this.onFinish(),
    ]);

    const timesAccurate =
      this.hasFullyCompletedChallenge() &&
      this.challengeStatus === ChallengeStatus.COMPLETED;

    const overallSplits = await this.createChallengeSplits(timesAccurate);
    if (timesAccurate) {
      await this.updatePersonalBests(overallSplits);
    }

    // TODO(frolv): Update player stats.
  }

  public async finalizeUpdates(): Promise<Partial<ModifiableChallengeFields>> {
    if (Object.keys(this.updates).length === 0) {
      return {};
    }

    const updates = this.updates;
    await this.updateChallenge(updates);
    this.updates = {};
    return updates;
  }

  /**
   * Processes client events for a single stage of the challenge.
   * @param stage The stage of the events.
   * @param events The events to process.
   * @returns State updates that have been applied.
   */
  public async processStage(
    stage: Stage,
    events: MergedEvents,
  ): Promise<Partial<ModifiableChallengeFields & CustomData>> {
    await this.loadIds();

    this.splits.clear();
    this.stageState = {
      deaths: [],
      npcs: new Map(),
    };

    this.setTotalChallengeTicks(
      this.totalChallengeTicks + events.getLastTick(),
    );

    // Set the appropriate status if the raid were to be finished at this
    // point.
    if (events.getStatus() === StageStatus.COMPLETED) {
      if (stage === this.lastStage) {
        this.challengeStatus = ChallengeStatus.COMPLETED;
      } else {
        this.challengeStatus = ChallengeStatus.RESET;
      }
    } else {
      this.challengeStatus = ChallengeStatus.WIPED;
    }

    await Promise.all([
      this.writeStageEvents(stage, events),
      this.onStageFinished(stage, events),
    ]);

    const stageSplits = await this.createChallengeSplits(events.isAccurate());
    if (events.isAccurate()) {
      await this.updatePersonalBests(stageSplits);
    }

    // TODO(frolv): Update player stats.

    const updates = (await this.finalizeUpdates()) as Partial<
      ModifiableChallengeFields & CustomData
    >;

    // Add the challenge status after the updates have been written to the
    // database, as it should only be updated in memory until the challenge is
    // fully completed.
    updates.status = this.challengeStatus;
    updates.customData = this.getCustomData();

    return updates;
  }

  /**
   * Registers a user as a recorder for this challenge.
   * @param userId The ID of the user.
   * @param recordingType The type of recording.
   */
  public async addRecorder(
    userId: number,
    recordingType: RecordingType,
  ): Promise<void> {
    await this.loadIds();
    await sql`
      INSERT INTO recorded_challenges (challenge_id, recorder_id, recording_type)
      VALUES (${this.databaseIds!.challenge}, ${userId}, ${recordingType})
    `;
  }

  protected async updateChallenge(
    updates: Partial<ModifiableChallengeFields>,
  ): Promise<void> {
    const translated = camelToSnakeObject(updates);
    await sql`
      UPDATE challenges
      SET ${sql(translated)}
      WHERE uuid = ${this.uuid}
    `;
  }

  private async createChallenge(
    startTime: Date,
    playerIds: number[],
  ): Promise<void> {
    const databaseId = await sql.begin(async (sql) => {
      const [{ id }] = await sql`
        INSERT INTO challenges (uuid, type, mode, scale, stage, status, start_time)
        VALUES (
          ${this.uuid},
          ${this.type},
          ${this.mode},
          ${this.party.length},
          ${this.stage},
          ${ChallengeStatus.IN_PROGRESS},
          ${startTime}
        )
        RETURNING id;
      `;

      const challengePlayers = this.party.map((name, i) => ({
        challenge_id: id,
        player_id: playerIds[i],
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

    this.databaseIds = {
      challenge: databaseId,
      players: playerIds,
    };

    await this.onCreate();
  }

  private async deleteChallenge(): Promise<void> {
    const [result] = await Promise.all([
      sql`DELETE FROM challenges WHERE id = ${this.databaseIds!.challenge}`,
      this.dataRepository.deleteChallenge(this.uuid).catch((e) => {
        logger.error(`${this.uuid}: Failed to delete challenge data:`, e);
      }),
    ]);
    if (result.count > 0) {
      await sql`
          UPDATE players
          SET total_recordings = total_recordings - 1
          WHERE id = ANY(${this.databaseIds!.players})
        `;
    }
  }

  private async loadIds(): Promise<void> {
    if (this.databaseIds !== null) {
      return;
    }

    const [challenge] =
      await sql`SELECT id FROM challenges WHERE uuid = ${this.uuid}`;
    if (!challenge) {
      throw new Error(`Challenge ${this.uuid} does not exist`);
    }

    const players = await sql`
      SELECT player_id
      FROM challenge_players
      WHERE challenge_id = ${challenge.id}
      ORDER BY orb
    `;

    this.databaseIds = {
      challenge: challenge.id,
      players: players.map((row) => row.player_id),
    };
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
        challenge_id: this.databaseIds!.challenge,
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
    const playerIds = this.databaseIds!.players;

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
        AND personal_bests.player_id = ANY(${playerIds})
    `;

    const pbsByPlayer: Map<
      number,
      Map<SplitType, { ticks: number; id: number }>
    > = new Map(playerIds.map((id) => [id, new Map()]));
    currentPbs.forEach((pb) => {
      pbsByPlayer.get(pb.player_id)!.set(pb.type, {
        ticks: pb.ticks,
        id: pb.challenge_split_id,
      });
    });

    const pbRowsToCreate: Array<CamelToSnakeCase<PersonalBest>> = [];

    for (const split of splits) {
      const pbRowsToUpdate: Array<postgres.Helper<number[]>> = [];

      playerIds.forEach((playerId, i) => {
        const currentPb = pbsByPlayer.get(playerId)!.get(split.type);

        if (currentPb === undefined) {
          logger.info(
            `Setting PB(${split.type}, ${this.party.length}) for ` +
              `${this.party[i]}#${playerId} to ${split.ticks}`,
          );
          pbRowsToCreate.push({
            player_id: playerId,
            challenge_split_id: split.id,
          });
        } else if (split.ticks < currentPb.ticks) {
          logger.info(
            `Updating PB(${split.type}, ${this.party.length}) for ` +
              `${this.party[i]}#${playerId} to ${split.ticks}`,
          );
          pbRowsToUpdate.push(sql([playerId, currentPb.id]));
        } else {
          logger.debug(
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

  private async writeStageEvents(
    stage: Stage,
    events: MergedEvents,
  ): Promise<void> {
    const rawEvents = Array.from(events);

    let dbEventsCount = 0;
    if (events.isAccurate()) {
      // dbEventsCount = await this.writeQueryableEvents(rawEvents);
    }

    // `saveProtoStageEvents` modifies the events, so it must be called last.
    await this.dataRepository.saveProtoStageEvents(
      this.uuid,
      stage,
      this.party,
      rawEvents,
    );

    logger.info(
      'Challenge %s: saved %d total, %d queryable events for stage %s (accurate=%s)',
      this.uuid,
      rawEvents.length,
      dbEventsCount,
      stage,
      events.isAccurate(),
    );
  }

  protected constructor(
    dataRepository: DataRepository,
    type: ChallengeType,
    firstStage: Stage,
    lastStage: Stage,
    uuid: string,
    mode: ChallengeMode,
    stage: Stage,
    stageStatus: StageStatus,
    party: string[],
    extraFields: InitializedFields = {},
  ) {
    this.dataRepository = dataRepository;
    this.firstStage = firstStage;
    this.lastStage = lastStage;

    this.uuid = uuid;
    this.type = type;
    this.mode = mode;
    this.stage = stage;
    this.stageStatus = stageStatus;
    this.party = party;

    this.splits = new Map();
    this.databaseIds = null;
    this.updates = {};
    this.stageState = null;

    this.totalDeaths = extraFields.totalDeaths ?? 0;
    this.reportedTimes = extraFields.reportedTimes ?? null;
    this.challengeStatus =
      extraFields.challengeStatus ?? ChallengeStatus.IN_PROGRESS;
    this.totalChallengeTicks = extraFields.totalChallengeTicks ?? 0;
  }

  /**
   * Invoked when the challenge is created in the database.
   * Should create any additional data required for the specific implementation.
   */
  protected abstract onCreate(): Promise<void>;

  /**
   * Invoked when the challenge is finished.
   */
  protected abstract onFinish(): Promise<void>;

  /**
   * Invoked after all events have been processed for a stage.
   * @param stage The stage of the events.
   * @param events The events that were processed.
   */
  protected abstract onStageFinished(
    stage: Stage,
    events: MergedEvents,
  ): Promise<void>;

  /**
   * Returns any custom state data the challenge should store while active.
   */
  protected abstract getCustomData(): object | null;

  /**
   * Returns whether every stage within the challenge has been recorded.
   */
  protected abstract hasFullyCompletedChallenge(): boolean;

  protected getDataRepository(): DataRepository {
    return this.dataRepository;
  }

  protected getDatabaseIds(): DatabaseIds | null {
    return this.databaseIds;
  }

  protected getStage(): Stage {
    return this.stage;
  }

  protected getTotalChallengeTicks(): number {
    return this.totalChallengeTicks;
  }

  protected getOverallTicks(): number {
    return this.reportedTimes?.overall ?? 0;
  }

  protected setSplit(type: SplitType, ticks: number): void {
    if (ticks > 0) {
      this.splits.set(type, ticks);
    }
  }

  protected getSplit(type: SplitType): number | undefined {
    return this.splits.get(type);
  }

  protected getStageState(): StageState | null {
    return this.stageState;
  }
}
