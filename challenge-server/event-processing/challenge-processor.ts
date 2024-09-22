import {
  Challenge as ApiChallenge,
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  DataRepository,
  PrimaryMeleeGear,
  Stage,
  StageStatus,
  camelToSnakeObject,
} from '@blert/common';

import sql from '../db';
import logger from '../log';
import { Players } from '../players';

export type InitializedFields = {
  databaseId?: number;
  challengeStatus?: ChallengeStatus;
  playerIds?: number[];
  totalChallengeTicks?: number;
};

type ModifiableChallengeFields = Pick<
  ApiChallenge,
  | 'status'
  | 'stage'
  | 'mode'
  | 'challengeTicks'
  | 'overallTicks'
  | 'totalDeaths'
>;

export default abstract class ChallengeProcessor {
  private dataRepository: DataRepository;

  private uuid: string;
  private databaseId: number | null;
  private type: ChallengeType;
  private mode: ChallengeMode;
  private challengeStatus: ChallengeStatus;
  private stage: Stage;
  private stageStatus: StageStatus;
  private party: string[];
  private playerIds: number[];
  private totalChallengeTicks: number;
  private reportedChallengeTicks: number | null;

  /** Returns the challenge's UUID. */
  public getUuid(): string {
    return this.uuid;
  }

  public setReportedChallengeTicks(ticks: number): void {
    this.reportedChallengeTicks = ticks;
  }

  public async createNew(startTime: Date): Promise<void> {
    const playerIds = await Promise.all(this.party.map(Players.startChallenge));
    if (
      playerIds.length !== this.party.length ||
      playerIds.some((id) => id === null)
    ) {
      throw new Error('Failed to find all player IDs');
    }

    this.playerIds = playerIds as number[];
    await this.createChallenge(startTime);
  }

  public async finish(): Promise<void> {
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
      this.reportedChallengeTicks !== null &&
      this.reportedChallengeTicks !== this.totalChallengeTicks
    ) {
      logger.warn(
        `Challenge time mismatch: recorded ${this.totalChallengeTicks}, ` +
          `reported ${this.reportedChallengeTicks}`,
      );
      this.totalChallengeTicks = this.reportedChallengeTicks;
    }

    this.updateChallenge({
      status: this.challengeStatus,
      challengeTicks: this.totalChallengeTicks,
    });
  }

  protected async updateChallenge(
    updates: Partial<ModifiableChallengeFields>,
  ): Promise<void> {
    const translated = camelToSnakeObject(updates);

    await sql`
      UPDATE challenges SET ${sql(translated)} WHERE id = ${this.databaseId}
    `;
  }

  private async createChallenge(startTime: Date): Promise<void> {
    this.databaseId = await sql.begin(async (sql) => {
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
        player_id: this.playerIds[i],
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

    await this.onCreate();
  }

  private async deleteChallenge(): Promise<void> {
    const [result] = await Promise.all([
      sql`DELETE FROM challenges WHERE id = ${this.databaseId}`,
      this.dataRepository.deleteChallenge(this.uuid).catch((e) => {
        logger.error(`${this.uuid}: Failed to delete challenge data:`, e);
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

  protected constructor(
    dataRepository: DataRepository,
    uuid: string,
    type: ChallengeType,
    mode: ChallengeMode,
    stage: Stage,
    stageStatus: StageStatus,
    party: string[],
    extraFields: InitializedFields = {},
  ) {
    this.dataRepository = dataRepository;
    this.uuid = uuid;
    this.type = type;
    this.mode = mode;
    this.stage = stage;
    this.stageStatus = stageStatus;
    this.party = party;

    this.reportedChallengeTicks = null;

    this.databaseId = extraFields.databaseId ?? null;
    this.challengeStatus =
      extraFields.challengeStatus ?? ChallengeStatus.IN_PROGRESS;
    this.playerIds = extraFields.playerIds ?? [];
    this.totalChallengeTicks = extraFields.totalChallengeTicks ?? 0;
  }

  /**
   * Invoked when the challenge is created in the database.
   * Should create any additional data required for the specific implementation.
   */
  protected abstract onCreate(): Promise<void>;

  protected getDataRepository(): DataRepository {
    return this.dataRepository;
  }

  protected getDatabaseId(): number | null {
    return this.databaseId;
  }
}
