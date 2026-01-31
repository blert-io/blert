import {
  Challenge as ApiChallenge,
  CamelToSnakeCase,
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  DataRepository,
  ItemDelta,
  MaidenCrab,
  Nylo,
  PlayerStats,
  PriceTracker,
  PrimaryMeleeGear,
  QueryableEventField,
  QueryableEventRow,
  RecordingType,
  RoomNpc,
  RoomNpcType,
  Session as ApiSession,
  SessionStatus,
  SkillLevel,
  SplitType,
  Stage,
  StageStatus,
  VerzikCrab,
  adjustSplitForMode,
  camelToSnakeObject,
  isPostgresUniqueViolation,
  partyHash,
  SESSION_ACTIVITY_DURATION_MS,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';
import { v4 as uuidv4 } from 'uuid';

import sql from '../db';
import logger from '../log';
import { MergedEvents } from '../merging';
import {
  recordQueryableEvents,
  recordReportedTimeMismatch,
  recordRepositoryWrite,
  recordSessionFinalized,
} from '../metrics';
import { Players } from '../players';

export type InitializedFields = {
  databaseId?: number;
  sessionId?: number;
  players?: PlayerInfo[];
  totalDeaths?: number;
  challengeStatus?: ChallengeStatus;
  totalChallengeTicks?: number;
  reportedTimes?: ReportedTimes | null;
  customData?: object | null;
  stageAttempt?: number | null;
  partyChangedMidChallenge?: boolean;
};

type ModifiableChallengeFieldKey =
  | 'challengeTicks'
  | 'mode'
  | 'stage'
  | 'status'
  | 'totalDeaths';

function isModifiableChallengeFieldKey(
  key: string,
): key is ModifiableChallengeFieldKey {
  return ['challengeTicks', 'mode', 'stage', 'status', 'totalDeaths'].includes(
    key,
  );
}

type ModifiableChallengeFields = Pick<
  ApiChallenge,
  ModifiableChallengeFieldKey
>;

type DatabaseChallengeFields = ModifiableChallengeFields &
  Pick<ApiChallenge, 'overallTicks' | 'finishTime'> & {
    fullRecording: boolean;
  };

type CustomData = {
  players: PlayerInfo[];
  customData: object | null;
};

type PlayerInfo = {
  id: number;
  gear: PrimaryMeleeGear;
};

export type ChallengeState = ModifiableChallengeFields &
  CustomData & {
    id: number;
    sessionId: number;
    uuid: string;
    type: ChallengeType;
    party: string[];
    stageStatus: StageStatus;
    reportedChallengeTicks: number | null;
    reportedOverallTicks: number | null;
    stageAttempt: number | null;
    partyChangedMidChallenge: boolean;
  };

export type Session = Pick<
  ApiSession,
  'challengeType' | 'challengeMode' | 'partyHash'
> & { id: number };

export type ModifiableSessionFields = Pick<
  ApiSession,
  'endTime' | 'challengeMode' | 'status'
>;

export type ReportedTimes = {
  challenge: number;
  overall: number;
};

export type ChallengeSplit = {
  type: SplitType;
  ticks: number;
  scale: number;
  accurate: boolean;
};
export type ChallengeSplitWithId = ChallengeSplit & { id: number };

type PersonalBest = {
  playerId: number;
  challengeSplitId: number;
};

type StageState = {
  deaths: string[];
  npcs: Map<string, RoomNpc>;
  eventsToWrite: Event[];
  playerStats: Partial<PlayerStats>[];
};

export default abstract class ChallengeProcessor {
  private readonly dataRepository: DataRepository;
  private readonly priceTracker: PriceTracker;
  private readonly firstStage: Stage;
  private readonly lastStage: Stage;

  private readonly uuid: string;
  private readonly type: ChallengeType;
  private databaseId: number;
  private sessionId: number;
  private mode: ChallengeMode;
  private challengeStatus: ChallengeStatus;
  private stage: Stage;
  private stageStatus: StageStatus;
  private stageAttempt: number | null;
  private party: string[];
  private players: PlayerInfo[];
  private totalChallengeTicks: number;
  private totalDeaths: number;
  private reportedTimes: ReportedTimes | null;
  private partyChangedMidChallenge: boolean;

  private splits: Map<SplitType, number>;
  private stageState: StageState;

  private pendingUpdates: {
    database: Partial<ModifiableChallengeFields>;
    redis: Partial<
      Omit<ChallengeState, ModifiableChallengeFieldKey | 'customData'>
    >;
  };

  /** Returns the challenge's UUID. */
  public getUuid(): string {
    return this.uuid;
  }

  public getState(): ChallengeState {
    return {
      id: this.databaseId,
      sessionId: this.sessionId,
      uuid: this.uuid,
      type: this.type,
      mode: this.mode,
      stage: this.stage,
      stageAttempt: this.stageAttempt,
      status: this.challengeStatus,
      stageStatus: this.stageStatus,
      party: this.party,
      challengeTicks: this.totalChallengeTicks,
      totalDeaths: this.totalDeaths,
      reportedChallengeTicks: this.reportedTimes?.challenge ?? null,
      reportedOverallTicks: this.reportedTimes?.overall ?? null,
      players: this.players,
      partyChangedMidChallenge: this.partyChangedMidChallenge,
      customData: this.getCustomData(),
    };
  }

  public setMode(mode: ChallengeMode): void {
    if (mode != ChallengeMode.NO_MODE && mode !== this.mode) {
      this.mode = mode;
      this.prepareUpdates({ mode });
    }
  }

  public updateParty(party: string[]): void {
    const hasChanged =
      party.length !== this.party.length ||
      party.some((p) => !this.party.includes(p));

    if (hasChanged && !this.partyChangedMidChallenge) {
      // A player has left the challenge part way through. In-game, this can
      // cause some mechanics to scale down or change. Blert does not attempt
      // to account for this, so we flag the challenge as inaccurate from this
      // point onwards.
      this.partyChangedMidChallenge = true;
      this.prepareUpdates({ partyChangedMidChallenge: true });

      logger.warn('challenge_party_changed', {
        challengeUuid: this.uuid,
        oldParty: this.party,
        newParty: party,
      });
    }
  }

  public startStage(stage: Stage): void {
    if (stage !== this.stage) {
      this.stage = stage;
      this.stageAttempt = this.isRetriable(stage) ? 1 : null;
      this.prepareUpdates({ stage, stageAttempt: this.stageAttempt });
    } else if (this.isRetriable(stage)) {
      this.stageAttempt = (this.stageAttempt ?? 0) + 1;
      this.prepareUpdates({ stageAttempt: this.stageAttempt });
    } else if (stage !== this.firstStage) {
      logger.error('challenge_restart_non_retriable_stage', {
        challengeUuid: this.uuid,
        stage,
      });
    }
  }

  public getChallengeStatus(): ChallengeStatus {
    return this.challengeStatus;
  }

  public getStage(): Stage {
    return this.stage;
  }

  public getStageAttempt(): number | null {
    return this.stageAttempt;
  }

  public getSessionId(): number {
    return this.sessionId;
  }

  protected getDatabaseId(): number {
    return this.databaseId;
  }

  protected addPlayerDeath(player: string): void {
    this.totalDeaths += 1;
    this.prepareUpdates({ totalDeaths: this.totalDeaths });
    this.stageState.deaths.push(player);
  }

  protected setTotalChallengeTicks(ticks: number): void {
    if (ticks !== this.totalChallengeTicks) {
      this.totalChallengeTicks = ticks;
      this.prepareUpdates({ challengeTicks: ticks });
    }
  }

  public setReportedTimes(times: ReportedTimes): void {
    this.reportedTimes = times;
  }

  /**
   * Returns the final number of ticks to be counted for the challenge.
   * Implementations can override this if the challenge can continue past its
   * last stage.
   *
   * @returns The final challenge ticks.
   */
  protected getFinalChallengeTicks(): number {
    return this.totalChallengeTicks;
  }

  /**
   * Creates a new challenge record, and optionally a session.
   *
   * @param startTime The time at which the challenge was started.
   * @param sessionId The ID of the session that created the challenge.
   *   If `null`, a new session will be created for the challenge.
   */
  public async createNew(
    startTime: Date,
    sessionId: number | null,
  ): Promise<void> {
    const playerIds = await Promise.all(
      this.party.map((name) => Players.startChallenge(name)),
    );
    if (
      playerIds.length !== this.party.length ||
      playerIds.some((id) => id === null)
    ) {
      throw new Error('Failed to find all player IDs');
    }

    playerIds.forEach((id, i) => {
      this.players[i].id = id!;
    });

    await this.createChallengeWithSession(startTime, sessionId);
  }

  /**
   * Finalizes the challenge data in the database.
   * @param finishTime The time at which the challenge was finished.
   * @returns `true` if the challenge was written to the database, `false` if
   * the challenge was deleted.
   */
  public async finish(finishTime: Date): Promise<boolean> {
    await this.loadIds();

    this.splits.clear();
    this.stageState = this.initialStageState();

    if (this.totalChallengeTicks === 0) {
      logger.info('challenge_finished_no_data', { challengeUuid: this.uuid });
      await this.deleteChallenge();
      return false;
    }

    if (this.stageStatus === StageStatus.STARTED) {
      logger.info('challenge_finished_stage_in_progress', {
        challengeUuid: this.uuid,
      });
      this.challengeStatus = ChallengeStatus.ABANDONED;
    }

    let finalChallengeTicks = this.getFinalChallengeTicks();

    if (
      this.reportedTimes !== null &&
      this.reportedTimes.challenge !== finalChallengeTicks
    ) {
      recordReportedTimeMismatch('challenge');
      logger.warn('challenge_time_mismatch', {
        challengeUuid: this.uuid,
        recordedTicks: finalChallengeTicks,
        reportedTicks: this.reportedTimes.challenge,
      });
      finalChallengeTicks = this.reportedTimes.challenge;
    }

    await Promise.all([
      this.updateChallenge({
        status: this.challengeStatus,
        // This is different from `finalChallengeTicks`, as it includes stages
        // beyond the final stage of the challenge.
        challengeTicks: this.totalChallengeTicks,
        overallTicks: this.reportedTimes?.overall ?? null,
        finishTime,
        fullRecording: this.hasFullyRecordedUpTo(this.stage),
      }),
      ChallengeProcessor.updateSession(this.sessionId, { endTime: finishTime }),
      this.onFinish(finalChallengeTicks),
    ]);

    const timesAccurate =
      !this.partyChangedMidChallenge &&
      this.hasFullyRecordedUpTo(this.lastStage) &&
      this.challengeStatus === ChallengeStatus.COMPLETED;

    const overallSplits = await this.createChallengeSplits(timesAccurate);
    if (timesAccurate) {
      await this.updatePersonalBests(overallSplits);
    }

    await this.updateAllPlayersStats();

    return true;
  }

  public async finalizeUpdates(): Promise<Partial<ChallengeState>> {
    const updatedState: Partial<ChallengeState> = {
      ...this.pendingUpdates.redis,
      ...this.pendingUpdates.database,
    };
    const databaseUpdates = this.pendingUpdates.database;

    this.pendingUpdates = {
      database: {},
      redis: {},
    };

    if (Object.keys(databaseUpdates).length === 0) {
      return updatedState;
    }

    const updatePromises = [this.updateChallenge(databaseUpdates)];
    if ('mode' in databaseUpdates) {
      updatePromises.push(
        ChallengeProcessor.updateSession(this.sessionId, {
          challengeMode: databaseUpdates.mode,
        }),
      );
    }

    await Promise.all(updatePromises);
    return updatedState;
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
    this.stageState = this.initialStageState();

    for (const event of events) {
      if (event.hasPlayer()) {
        const player = event.getPlayer()!;
        if (!this.party.includes(player.getName())) {
          logger.error('challenge_event_unknown_player', {
            challengeUuid: this.uuid,
            eventType: event.getType(),
            playerName: player.getName(),
          });
          continue;
        }
      }

      await this.processEvent(this.stageState, events, event);
    }

    this.setTotalChallengeTicks(
      this.totalChallengeTicks + events.getLastTick(),
    );

    // Set the appropriate status if the raid were to be finished at this point.
    if (stage > this.lastStage) {
      // Some challenges can continue past their last stage. They should always
      // count as completed as long as the last stage is completed.
      this.challengeStatus = ChallengeStatus.COMPLETED;
    } else if (events.getStatus() === StageStatus.COMPLETED) {
      if (stage === this.lastStage) {
        this.challengeStatus = ChallengeStatus.COMPLETED;
      } else {
        this.challengeStatus = ChallengeStatus.RESET;
      }
    } else if (events.getStatus() === StageStatus.STARTED) {
      this.challengeStatus = ChallengeStatus.ABANDONED;
    } else {
      this.challengeStatus = ChallengeStatus.WIPED;
    }

    await this.onStageFinished(stage, events);

    const accurate = !this.partyChangedMidChallenge && events.isAccurate();

    await Promise.all([
      this.addStageDeaths(),
      this.writeStageEvents(stage, this.stageState.eventsToWrite, accurate),
    ]);

    const stageSplits = await this.createChallengeSplits(accurate);
    if (accurate) {
      await this.updatePersonalBests(stageSplits);
    }

    await this.updateAllPlayersStats();

    const updates = (await this.finalizeUpdates()) as Partial<
      ModifiableChallengeFields & CustomData
    >;

    // Add the challenge status after the updates have been written to the
    // database, as it should only be updated in memory until the challenge is
    // fully completed.
    updates.status = this.challengeStatus;
    updates.players = this.players;
    updates.customData = this.getCustomData();

    return updates;
  }

  /**
   * Finds sessions in the database which may potentially be expired.
   *
   * A potentially-expired session is an active session which either:
   * - Has an end time which is older than the session activity duration, or
   * - Has no end time and was started more than twice the session activity
   *   duration ago.
   *
   * These are not definitive indicators of expiration; the Redis session key
   * is the source of truth and must be checked.
   *
   * @returns Information about the potentially-expiring sessions.
   */
  public static async loadExpiringSessions(): Promise<Session[]> {
    const now = Date.now();

    const sessions = await sql<
      {
        id: number;
        challenge_type: ChallengeType;
        challenge_mode: ChallengeMode;
        party_hash: string;
      }[]
    >`
      SELECT id, challenge_type, challenge_mode, party_hash
      FROM challenge_sessions
      WHERE status = ${SessionStatus.ACTIVE} AND
        (end_time < ${now - SESSION_ACTIVITY_DURATION_MS}
        OR (end_time IS NULL AND start_time < ${now - SESSION_ACTIVITY_DURATION_MS * 2}))
    `;

    return sessions.map((session) => ({
      id: session.id,
      challengeType: session.challenge_type,
      challengeMode: session.challenge_mode,
      partyHash: session.party_hash,
    }));
  }

  public static async finalizeSession(sessionId: number): Promise<void> {
    const loadStatusCounts = sql<{ status: string; count: string }[]>`
      SELECT status, COUNT(*) FROM challenges
      WHERE session_id = ${sessionId}
      GROUP BY status
    `;
    const loadLastFinishTime = sql<{ finish_time: Date }[]>`
      SELECT finish_time FROM challenges
      WHERE session_id = ${sessionId}
      ORDER BY finish_time DESC NULLS FIRST
      LIMIT 1
    `;
    const loadMostFrequentMode = sql<{ mode: ChallengeMode }[]>`
      SELECT mode FROM challenges
      WHERE session_id = ${sessionId}
      GROUP BY mode ORDER BY COUNT(*) DESC, mode ASC LIMIT 1
    `;

    const [statusCounts, lastFinishTime, mostFrequentMode] = await Promise.all([
      loadStatusCounts,
      loadLastFinishTime,
      loadMostFrequentMode,
    ]);

    if (statusCounts.length === 0) {
      logger.warn('session_no_challenges', { sessionId });
      await sql`DELETE FROM challenge_sessions WHERE id = ${sessionId}`;
      return;
    }

    const updates: Partial<ModifiableSessionFields> = {
      status: SessionStatus.COMPLETED,
    };

    if (
      statusCounts.length === 1 &&
      (Number.parseInt(statusCounts[0].status) as ChallengeStatus) ===
        ChallengeStatus.ABANDONED
    ) {
      logger.warn('session_only_abandoned_challenges', { sessionId });
      updates.status = SessionStatus.HIDDEN;
    }

    if (lastFinishTime?.[0]?.finish_time) {
      updates.endTime = lastFinishTime[0].finish_time;
    }

    if (mostFrequentMode?.[0]?.mode) {
      updates.challengeMode = mostFrequentMode[0].mode;
    }

    await this.updateSession(sessionId, updates);

    recordSessionFinalized();
  }

  private static async updateSession(
    sessionId: number,
    updates: Partial<ModifiableSessionFields>,
  ): Promise<void> {
    const translated: Record<string, unknown> = camelToSnakeObject(updates);
    if ('endTime' in updates && updates.endTime !== null) {
      translated.end_time = updates.endTime!.getTime();
    }

    await sql`
      UPDATE challenge_sessions
      SET ${sql(translated)}
      WHERE id = ${sessionId}
    `;
  }

  /**
   * Registers a user as a recorder for a challenge.
   * @param userId The ID of the user.
   * @param recordingType The type of recording.
   */
  public static async addRecorder(
    uuid: string,
    userId: number,
    recordingType: RecordingType,
  ): Promise<void> {
    const [challenge] = await sql<[{ id: number }?]>`
      SELECT id FROM challenges WHERE uuid = ${uuid}
    `;

    if (challenge === undefined) {
      throw new Error(`Challenge ${uuid} does not exist`);
    }

    await sql`
      INSERT INTO recorded_challenges (challenge_id, recorder_id, recording_type)
      VALUES (${challenge.id}, ${userId}, ${recordingType})
    `;
  }

  private async processEvent(
    stageState: StageState,
    events: MergedEvents,
    event: Event,
  ): Promise<void> {
    switch (event.getType()) {
      case Event.Type.PLAYER_UPDATE:
        await this.tryDetermineGear(event.getPlayer()!);
        break;

      case Event.Type.PLAYER_DEATH:
        this.addPlayerDeath(event.getPlayer()!.getName());
        break;

      case Event.Type.NPC_SPAWN:
        this.handleNpcSpawn(stageState, event);
        break;

      case Event.Type.NPC_DEATH:
        const npc = stageState.npcs.get(event.getNpc()!.getRoomId().toString());
        if (npc !== undefined) {
          npc.deathTick = event.getTick();
          npc.deathPoint = { x: event.getXCoord(), y: event.getYCoord() };
        }
        break;
    }

    const shouldSave = await this.processChallengeEvent(events, event);
    if (shouldSave) {
      stageState.eventsToWrite.push(event);
    }
  }

  /**
   * Creates a `RoomNpc` entry in the NPC map for a newly-spawned NPC.
   *
   * @param event The spawn event.
   */
  private handleNpcSpawn(stageState: StageState, event: Event): void {
    const npc = event.getNpc();
    if (npc === undefined) {
      return;
    }

    const npcCommon = {
      type: RoomNpcType.BASIC,
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
      stageState.npcs.set(npc.getRoomId().toString(), crab);
    } else if (nylo !== undefined) {
      const nyloDesc: Nylo = {
        ...npcCommon,
        type: RoomNpcType.NYLO,
        nylo,
      };
      stageState.npcs.set(npc.getRoomId().toString(), nyloDesc);
    } else if (verzikCrab !== undefined) {
      const crab: VerzikCrab = {
        ...npcCommon,
        type: RoomNpcType.VERZIK_CRAB,
        verzikCrab,
      };
      stageState.npcs.set(npc.getRoomId().toString(), crab);
    } else {
      stageState.npcs.set(npc.getRoomId().toString(), npcCommon);
    }
  }

  private async updateChallenge(
    updates: Partial<DatabaseChallengeFields>,
  ): Promise<void> {
    const translated: Record<string, unknown> = camelToSnakeObject(updates);
    if ('finishTime' in updates && updates.finishTime !== null) {
      translated.finish_time = updates.finishTime!.getTime();
    }

    await sql`
      UPDATE challenges
      SET ${sql(translated)}
      WHERE uuid = ${this.uuid}
    `;
  }

  private async createChallengeWithSession(
    startTime: Date,
    sessionId: number | null,
  ): Promise<void> {
    const [id, sid] = await sql.begin(async (sql) => {
      if (sessionId === null) {
        const sessionUuid = uuidv4();

        const [{ id }] = await sql<[{ id: number }]>`
          INSERT INTO challenge_sessions (
            uuid,
            challenge_type,
            challenge_mode,
            scale,
            party_hash,
            start_time,
            status
          ) VALUES (
           ${sessionUuid},
           ${this.type},
           ${this.mode},
           ${this.getScale()},
           ${partyHash(this.party)},
           ${startTime},
           ${SessionStatus.ACTIVE}
          )
          RETURNING id
        `;

        logger.info('session_created', {
          sessionUuid,
          sessionId: id,
          challengeType: this.type,
          challengeMode: this.mode,
          party: this.party,
          partyHash: partyHash(this.party),
        });

        sessionId = id;
      }

      const [{ id }] = await sql<[{ id: number }]>`
        INSERT INTO challenges (
          uuid,
          type,
          mode,
          scale,
          stage,
          status,
          start_time,
          session_id
        ) VALUES (
          ${this.uuid},
          ${this.type},
          ${this.mode},
          ${this.getScale()},
          ${this.stage},
          ${ChallengeStatus.IN_PROGRESS},
          ${startTime},
          ${sessionId}
        )
        RETURNING id;
      `;

      const challengePlayers = this.party.map((name, i) => ({
        challenge_id: id,
        player_id: this.players[i].id,
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

      return [id, sessionId];
    });

    this.databaseId = id;
    this.sessionId = sid;

    await this.onCreate();
  }

  private async deleteChallenge(): Promise<void> {
    const [result] = await Promise.all([
      sql`DELETE FROM challenges WHERE id = ${this.databaseId}`,
      this.dataRepository.deleteChallenge(this.uuid).catch((e) => {
        logger.error('challenge_delete_failed', {
          challengeUuid: this.uuid,
          error: e instanceof Error ? e.message : String(e),
        });
      }),
    ]);
    if (result.count > 0) {
      await sql`
          UPDATE players
          SET total_recordings = total_recordings - 1
          WHERE id = ANY(${this.players.map((p) => p.id)})
        `;
    }
  }

  private async loadIds(): Promise<void> {
    if (this.databaseId === -1 || this.sessionId === -1) {
      const [challenge] = await sql<
        [{ id: number; session_id: number }?]
      >`SELECT id, session_id FROM challenges WHERE uuid = ${this.uuid}`;
      if (!challenge) {
        throw new Error(`Challenge ${this.uuid} does not exist`);
      }

      this.databaseId = challenge.id;
      this.sessionId = challenge.session_id;
    }

    if (this.players.every((p) => p.id !== -1)) {
      return;
    }

    const players = await sql<{ player_id: number }[]>`
      SELECT player_id
      FROM challenge_players
      WHERE challenge_id = ${this.databaseId}
      ORDER BY orb
    `;

    players.forEach((row, i) => {
      this.players[i].id = row.player_id;
    });
  }

  private async createChallengeSplits(
    accurate: boolean,
  ): Promise<ChallengeSplitWithId[]> {
    if (this.splits.size === 0) {
      return [];
    }

    const splitsToInsert: (ChallengeSplit & { challenge_id: number })[] = [];

    this.splits.forEach((ticks, split) => {
      splitsToInsert.push({
        challenge_id: this.databaseId,
        type: adjustSplitForMode(split, this.mode),
        scale: this.getScale(),
        ticks,
        accurate,
      });
    });

    try {
      const ids: { id: number }[] = await sql`
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
    } catch (e: any) {
      if (isPostgresUniqueViolation(e)) {
        logger.error('challenge_splits_insert_failed', {
          challengeUuid: this.uuid,
          error: e instanceof Error ? e.message : String(e),
        });
        return [];
      }

      throw e;
    }
  }

  /**
   * Compares the provided splits to the current personal bests for each player
   * in this challenge, updating the personal bests if the new times are better.
   *
   * @param splits Splits to check.
   */
  protected async updatePersonalBests(
    splits: ChallengeSplitWithId[],
  ): Promise<void> {
    if (splits.length === 0) {
      return;
    }

    const playerIds = this.players.map((p) => p.id);
    const splitTypes = splits.map((s) => s.type);
    const scale = this.getScale();

    const currentPbs = await sql<
      { player_id: number; type: SplitType; ticks: number }[]
    >`
      WITH ranked_pbs AS (
        SELECT
          pbh.player_id,
          cs.type,
          cs.ticks,
          ROW_NUMBER() OVER (
            PARTITION BY pbh.player_id, cs.type, cs.scale
            ORDER BY pbh.created_at DESC
          ) as rn
        FROM
          personal_best_history pbh
        JOIN
          challenge_splits cs ON pbh.challenge_split_id = cs.id
        WHERE
          pbh.player_id = ANY(${playerIds}) AND
          cs.type = ANY(${splitTypes}) AND
          cs.scale = ${scale}
      )
      SELECT
        player_id,
        type,
        ticks
      FROM
        ranked_pbs
      WHERE
        rn = 1
    `;

    const pbsByPlayer = new Map<number, Map<SplitType, { ticks: number }>>(
      playerIds.map((id) => [id, new Map()]),
    );
    currentPbs.forEach((pb) => {
      pbsByPlayer.get(pb.player_id)!.set(pb.type, { ticks: pb.ticks });
    });

    const pbRowsToCreate: (CamelToSnakeCase<PersonalBest> & {
      created_at: Date;
    })[] = [];

    // Give all the personal bests a consistent creation time.
    const now = new Date();

    const personalBests: {
      new: Record<string, [number, number][]>;
      updated: Record<string, [number, number][]>;
    } = {
      new: {},
      updated: {},
    };

    for (const split of splits) {
      playerIds.forEach((playerId, i) => {
        const currentPb = pbsByPlayer.get(playerId)!.get(split.type);
        const playerKey = `${this.party[i]}#${playerId}`;

        if (currentPb === undefined) {
          personalBests.new[playerKey] ??= [];
          personalBests.new[playerKey].push([split.type, split.ticks]);
          pbRowsToCreate.push({
            player_id: playerId,
            challenge_split_id: split.id,
            created_at: now,
          });
        } else if (split.ticks < currentPb.ticks) {
          personalBests.updated[playerKey] ??= [];
          personalBests.updated[playerKey].push([split.type, split.ticks]);
          pbRowsToCreate.push({
            player_id: playerId,
            challenge_split_id: split.id,
            created_at: now,
          });
        }
      });
    }

    logger.info('challenge_personal_bests_updated', {
      scale: this.getScale(),
      personalBests,
    });

    if (pbRowsToCreate.length > 0) {
      await sql`
        INSERT INTO personal_best_history ${sql(
          pbRowsToCreate,
          'player_id',
          'challenge_split_id',
          'created_at',
        )}
      `;
    }
  }

  /**
   * Update the stats of every player in the challenge from the current state.
   */
  private async updateAllPlayersStats() {
    const promises: Promise<void>[] = [];

    if (this.mode === ChallengeMode.TOB_ENTRY) {
      return;
    }

    this.players.forEach(({ id }, i) => {
      const stats = this.stageState.playerStats[i];
      if (stats !== undefined && Object.keys(stats).length > 0) {
        promises.push(Players.updateStats(id, stats));
      }
    });

    await Promise.all(promises);
  }

  private async addStageDeaths(): Promise<void> {
    const stageDeaths = this.stageState.deaths;
    if (stageDeaths.length === 0) {
      return;
    }

    const promises = [];
    for (const death of stageDeaths) {
      const playerIndex = this.party.indexOf(death);
      if (playerIndex === -1) {
        continue;
      }

      promises.push(
        sql`
          UPDATE challenge_players
          SET stage_deaths = COALESCE(stage_deaths, '{}') || ${[this.stage]}
          WHERE challenge_id = ${this.databaseId}
            AND player_id = ${this.players[playerIndex].id}
        `,
      );
    }

    await Promise.all(promises);
  }

  private async writeStageEvents(
    stage: Stage,
    events: Event[],
    accurate: boolean,
  ): Promise<void> {
    let dbEventsCount = 0;
    if (accurate) {
      dbEventsCount = await this.writeQueryableEvents(events);
      recordQueryableEvents(stage, dbEventsCount);
    }

    try {
      // `saveProtoStageEvents` modifies the events, so it must be called last.
      await this.dataRepository.saveProtoStageEvents(
        this.uuid,
        stage,
        this.party,
        events,
        this.stageAttempt ?? undefined,
      );

      recordRepositoryWrite('challenge', 'stage_events', 'success');
      logger.info('challenge_stage_events_saved', {
        challengeUuid: this.uuid,
        stage,
        totalEvents: events.length,
        queryableEvents: dbEventsCount,
        accurate,
      });
    } catch (e) {
      recordRepositoryWrite('challenge', 'stage_events', 'error');
      logger.error('challenge_stage_events_save_error', {
        challengeUuid: this.uuid,
        stage,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private async tryDetermineGear(player: Event.Player): Promise<void> {
    const playerIndex = this.getParty().indexOf(player.getName());
    if (playerIndex === -1) {
      return;
    }

    if (this.players[playerIndex].gear !== PrimaryMeleeGear.UNKNOWN) {
      return;
    }

    const equipment = player
      .getEquipmentDeltasList()
      .map((delta) => ItemDelta.fromRaw(delta));
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
        case ItemId.RADIANT_OATHPLATE_CHEST as number:
          gear = PrimaryMeleeGear.RADIANT_OATHPLATE;
          break;
        case ItemId.OATHPLATE_CHESTPLATE as number:
          gear = PrimaryMeleeGear.OATHPLATE;
          break;
        case ItemId.BLORVA_PLATEBODY as number:
          gear = PrimaryMeleeGear.BLORVA;
          break;
        case ItemId.TORVA_PLATEBODY as number:
          gear = PrimaryMeleeGear.TORVA;
          break;
        case ItemId.BANDOS_CHESTPLATE as number:
          gear = PrimaryMeleeGear.BANDOS;
          break;
      }
    }
    if (
      helm !== undefined &&
      (helm.getItemId() === (ItemId.VOID_MELEE_HELM as number) ||
        helm.getItemId() === (ItemId.VOID_MELEE_HELM_OR as number))
    ) {
      gear = PrimaryMeleeGear.ELITE_VOID;
    }

    if (gear !== null) {
      this.players[playerIndex].gear = gear;
      await sql`
        UPDATE challenge_players
        SET primary_gear = ${gear}
        WHERE
          challenge_id = ${this.databaseId}
          AND player_id = ${this.players[playerIndex].id}
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
        case Event.Type.PLAYER_ATTACK: {
          const attack = event.getPlayerAttack()!;
          const e = baseQueryableEvent(event);
          e.subtype = attack.getType();
          const playerIndex = this.party.indexOf(event.getPlayer()!.getName());
          if (playerIndex !== -1) {
            e.player_id = this.players[playerIndex].id;
          }
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

        case Event.Type.PLAYER_SPELL: {
          const spell = event.getPlayerSpell()!;
          const e = baseQueryableEvent(event);
          e.subtype = spell.getType();
          const playerIndex = this.party.indexOf(event.getPlayer()!.getName());
          if (playerIndex !== -1) {
            e.player_id = this.players[playerIndex].id;
          }
          switch (spell.getTargetCase()) {
            case Event.Spell.TargetCase.TARGET_PLAYER:
              const targetPlayerIndex = this.party.indexOf(
                spell.getTargetPlayer(),
              );
              if (targetPlayerIndex !== -1) {
                e[QueryableEventField.PLAYER_SPELL_TARGET_PLAYER] =
                  this.players[targetPlayerIndex].id;
              }
              break;
            case Event.Spell.TargetCase.TARGET_NPC:
              e.npc_id = spell.getTargetNpc()!.getId();
              break;
          }
          queryableEvents.push(e);
          break;
        }

        case Event.Type.PLAYER_DEATH: {
          const playerIndex = this.party.indexOf(event.getPlayer()!.getName());
          if (playerIndex !== -1) {
            const e = baseQueryableEvent(event);
            e.player_id = this.players[playerIndex].id;
            queryableEvents.push(e);
          }
          break;
        }

        case Event.Type.NPC_SPAWN:
        case Event.Type.NPC_DEATH: {
          const npc = event.getNpc()!;
          const e = baseQueryableEvent(event);
          const roomNpc = this.stageState.npcs.get(npc.getRoomId().toString());
          e.npc_id = npc.getId();
          if (roomNpc !== undefined) {
            e.subtype = roomNpc.type;
            switch (roomNpc.type) {
              case RoomNpcType.BASIC:
                break;
              case RoomNpcType.MAIDEN_CRAB:
                const maidenCrab = (roomNpc as MaidenCrab).maidenCrab;
                e[QueryableEventField.NPC_MAIDEN_CRAB_SPAWN] = maidenCrab.spawn;
                e[QueryableEventField.NPC_MAIDEN_CRAB_POSITION] =
                  maidenCrab.position;
                break;
              case RoomNpcType.NYLO:
                const nylo = (roomNpc as Nylo).nylo;
                e[QueryableEventField.NPC_NYLO_SPAWN_TYPE] = nylo.spawnType;
                e[QueryableEventField.NPC_NYLO_STYLE] = nylo.style;
                break;
              case RoomNpcType.VERZIK_CRAB:
                const verzikCrab = (roomNpc as VerzikCrab).verzikCrab;
                e[QueryableEventField.NPC_VERZIK_CRAB_PHASE] = verzikCrab.phase;
                e[QueryableEventField.NPC_VERZIK_CRAB_SPAWN] = verzikCrab.spawn;
                break;
            }
          }
          queryableEvents.push(e);
          break;
        }

        case Event.Type.NPC_ATTACK: {
          const attack = event.getNpcAttack()!;
          const e = baseQueryableEvent(event);
          e.subtype = attack.getAttack();
          e.npc_id = event.getNpc()!.getId();
          if (attack.hasTarget()) {
            const playerIndex = this.party.indexOf(attack.getTarget());
            if (playerIndex !== -1) {
              e.player_id = this.players[playerIndex].id;
            }
          }
          queryableEvents.push(e);
          break;
        }

        case Event.Type.TOB_MAIDEN_CRAB_LEAK: {
          const npc = event.getNpc()!;
          const maidenCrab = (
            this.stageState.npcs.get(npc.getRoomId().toString()) as MaidenCrab
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

        case Event.Type.TOB_BLOAT_DOWN: {
          const down = event.getBloatDown()!;
          const e = baseQueryableEvent(event);
          e[QueryableEventField.TOB_BLOAT_DOWN_NUMBER] = down.getDownNumber();
          e[QueryableEventField.TOB_BLOAT_DOWN_WALK_TIME] = down.getWalkTime();
          queryableEvents.push(e);
          break;
        }

        case Event.Type.TOB_NYLO_WAVE_STALL: {
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

  private initialStageState(): StageState {
    return {
      deaths: [],
      npcs: new Map(),
      eventsToWrite: [],
      playerStats: this.party.map(() => ({})),
    };
  }

  private prepareUpdates(
    updates: Partial<Omit<ChallengeState, 'customData'>>,
  ): void {
    for (const [key, value] of Object.entries(updates)) {
      if (isModifiableChallengeFieldKey(key)) {
        // @ts-expect-error: Dynamic key access on partial update type
        this.pendingUpdates.database[key] = value;
      } else {
        // @ts-expect-error: Dynamic key access on partial update type
        this.pendingUpdates.redis[key] = value;
      }
    }
  }

  protected constructor(
    dataRepository: DataRepository,
    priceTracker: PriceTracker,
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
    this.priceTracker = priceTracker;
    this.firstStage = firstStage;
    this.lastStage = lastStage;

    this.uuid = uuid;
    this.type = type;
    this.mode = mode;
    this.stage = stage;
    this.stageStatus = stageStatus;
    this.party = party;

    this.splits = new Map();
    this.pendingUpdates = {
      database: {},
      redis: {},
    };
    this.stageState = this.initialStageState();

    this.databaseId = extraFields.databaseId ?? -1;
    this.sessionId = extraFields.sessionId ?? -1;
    this.players =
      extraFields.players ??
      this.party.map((_) => ({ id: -1, gear: PrimaryMeleeGear.UNKNOWN }));
    this.totalDeaths = extraFields.totalDeaths ?? 0;
    this.reportedTimes = extraFields.reportedTimes ?? null;
    this.challengeStatus =
      extraFields.challengeStatus ?? ChallengeStatus.IN_PROGRESS;
    this.totalChallengeTicks = extraFields.totalChallengeTicks ?? 0;
    this.stageAttempt = extraFields.stageAttempt ?? null;
    this.partyChangedMidChallenge =
      extraFields.partyChangedMidChallenge ?? false;
  }

  /**
   * Invoked when the challenge is created in the database.
   * Should create any additional data required for the specific implementation.
   */
  protected abstract onCreate(): Promise<void>;

  /**
   * Invoked when the challenge is finished.
   */
  protected abstract onFinish(finalChallengeTicks: number): Promise<void>;

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
   * Handles an event occurring during a challenge stage.
   *
   * @param allEvents Full list of events for the stage for context.
   * @param event The event to process.
   * @returns `true` if the event data should be saved, `false` if not.
   */
  protected abstract processChallengeEvent(
    allEvents: MergedEvents,
    event: Event,
  ): Promise<boolean>;

  /**
   * Returns any custom state data the challenge should store while active.
   */
  protected abstract getCustomData(): object | null;

  /**
   * Returns whether the challenge has some recorded data for every stage
   * between its first stage and the provided stage, inclusive.
   */
  protected abstract hasFullyRecordedUpTo(stage: Stage): boolean;

  /**
   * Returns whether a stage can be attempted multiple times.
   * @param stage The stage to check.
   * @returns `true` if the stage can be attempted multiple times, `false` if not.
   */
  protected abstract isRetriable(stage: Stage): boolean;

  protected getDataRepository(): DataRepository {
    return this.dataRepository;
  }

  protected getPriceTracker(): PriceTracker {
    return this.priceTracker;
  }

  protected getParty(): string[] {
    return this.party;
  }

  protected getScale(): number {
    return this.party.length;
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

  protected getStageState(): StageState {
    return this.stageState;
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
      get: (obj: Partial<PlayerStats>, prop: keyof PlayerStats) =>
        prop in obj ? obj[prop] : 0,
    };

    if (playerIndex === -1) {
      return new Proxy<PlayerStats>({} as PlayerStats, defaultZero);
    }

    return new Proxy<PlayerStats>(
      this.stageState.playerStats[playerIndex] as PlayerStats,
      defaultZero,
    );
  }
}

enum ItemId {
  VOID_MELEE_HELM = 11665,
  BANDOS_CHESTPLATE = 11832,
  TORVA_PLATEBODY = 26384,
  VOID_MELEE_HELM_OR = 26477,
  BLORVA_PLATEBODY = 28256,
  OATHPLATE_CHESTPLATE = 30753,
  RADIANT_OATHPLATE_CHEST = 30779,
}
