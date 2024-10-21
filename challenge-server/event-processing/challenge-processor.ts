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

import sql from '../db';
import logger from '../log';
import { MergedEvents } from '../merge';
import { Players } from '../players';

export type InitializedFields = {
  databaseId?: number;
  players?: PlayerInfo[];
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

type DatabaseChallengeFields = ModifiableChallengeFields & {
  overallTicks: number | null;
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
  eventsToWrite: Event[];
  playerStats: Array<Partial<PlayerStats>>;
};

export default abstract class ChallengeProcessor {
  private readonly dataRepository: DataRepository;
  private readonly priceTracker: PriceTracker;
  private readonly firstStage: Stage;
  private readonly lastStage: Stage;

  private readonly uuid: string;
  private readonly type: ChallengeType;
  private databaseId: number;
  private mode: ChallengeMode;
  private challengeStatus: ChallengeStatus;
  private stage: Stage;
  private stageStatus: StageStatus;
  private party: string[];
  private players: PlayerInfo[];
  private totalChallengeTicks: number;
  private totalDeaths: number;
  private reportedTimes: ReportedTimes | null;

  private splits: Map<SplitType, number>;
  private stageState: StageState;

  private updates: Partial<ModifiableChallengeFields>;

  /** Returns the challenge's UUID. */
  public getUuid(): string {
    return this.uuid;
  }

  public getState(): ChallengeState {
    return {
      id: this.databaseId,
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
      players: this.players,
      customData: this.getCustomData(),
    };
  }

  public setMode(mode: ChallengeMode): void {
    if (mode != ChallengeMode.NO_MODE && mode !== this.mode) {
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
    this.totalDeaths += 1;
    this.updates.totalDeaths = this.totalDeaths;
    this.stageState.deaths.push(player);
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

    playerIds.forEach((id, i) => {
      this.players[i].id = id!;
    });

    await this.createChallenge(startTime);
  }

  public async finish(): Promise<void> {
    await this.loadIds();

    this.stageState = this.initialStageState();

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
        overallTicks: this.reportedTimes?.overall ?? null,
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

    await this.updateAllPlayersStats();
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

    const startTime = process.hrtime();

    this.splits.clear();
    this.stageState = this.initialStageState();

    for (const event of events) {
      if (event.hasPlayer()) {
        const player = event.getPlayer()!;
        if (!this.party.includes(player.getName())) {
          logger.error(
            `Challenge ${this.uuid} received event type ${event.getType()} ` +
              `referencing unknown player ${player.getName()}`,
          );
          continue;
        }
      }

      await this.processEvent(this.stageState, events, event);
    }

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
    } else if (events.getStatus() === StageStatus.STARTED) {
      this.challengeStatus = ChallengeStatus.ABANDONED;
    } else {
      this.challengeStatus = ChallengeStatus.WIPED;
    }

    await Promise.all([
      this.writeStageEvents(
        stage,
        this.stageState.eventsToWrite,
        events.isAccurate(),
      ),
      this.onStageFinished(stage, events),
    ]);

    const stageSplits = await this.createChallengeSplits(events.isAccurate());
    if (events.isAccurate()) {
      await this.updatePersonalBests(stageSplits);
    }

    await this.updateAllPlayersStats();

    const updates = (await this.finalizeUpdates()) as Partial<
      ModifiableChallengeFields & CustomData
    >;

    const [deltaS, deltaNs] = process.hrtime(startTime);
    logger.debug(
      'Challenge %s: processed events for stage %s in %sms',
      this.uuid,
      stage,
      (deltaS * 1000 + deltaNs / 1e6).toFixed(2),
    );

    // Add the challenge status after the updates have been written to the
    // database, as it should only be updated in memory until the challenge is
    // fully completed.
    updates.status = this.challengeStatus;
    updates.players = this.players;
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
      VALUES (${this.databaseId}, ${userId}, ${recordingType})
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
        let npc = stageState.npcs.get(event.getNpc()!.getRoomId().toString());
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
    const translated = camelToSnakeObject(updates);
    await sql`
      UPDATE challenges
      SET ${sql(translated)}
      WHERE uuid = ${this.uuid}
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
          WHERE id = ANY(${this.players.map((p) => p.id)})
        `;
    }
  }

  private async loadIds(): Promise<void> {
    if (this.databaseId === -1) {
      const [challenge] =
        await sql`SELECT id FROM challenges WHERE uuid = ${this.uuid}`;
      if (!challenge) {
        throw new Error(`Challenge ${this.uuid} does not exist`);
      }

      this.databaseId = challenge.id;
    }

    if (this.players.every((p) => p.id !== -1)) {
      return;
    }

    const players = await sql`
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
    const playerIds = this.players.map((p) => p.id);

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

  /**
   * Update the stats of every player in the challenge from the current state.
   */
  private async updateAllPlayersStats() {
    const promises: Array<Promise<void>> = [];

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

  private async writeStageEvents(
    stage: Stage,
    events: Event[],
    accurate: boolean,
  ): Promise<void> {
    let dbEventsCount = 0;
    if (accurate) {
      dbEventsCount = await this.writeQueryableEvents(events);
    }

    // `saveProtoStageEvents` modifies the events, so it must be called last.
    await this.dataRepository.saveProtoStageEvents(
      this.uuid,
      stage,
      this.party,
      events,
    );

    logger.info(
      'Challenge %s: saved %d total, %d queryable events for stage %s (accurate=%s)',
      this.uuid,
      events.length,
      dbEventsCount,
      stage,
      accurate,
    );
  }

  private async tryDetermineGear(player: Event.Player): Promise<void> {
    const playerIndex = this.getParty().indexOf(player.getName());
    if (playerIndex === -1) {
      return;
    }

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
        case ItemId.BLORVA_PLATEBODY:
          gear = PrimaryMeleeGear.BLORVA;
          break;
        case ItemId.TORVA_PLATEBODY:
          gear = PrimaryMeleeGear.TORVA;
          break;
        case ItemId.BANDOS_CHESTPLATE:
          gear = PrimaryMeleeGear.BANDOS;
          break;
      }
    }
    if (
      helm !== undefined &&
      (helm.getItemId() === ItemId.VOID_MELEE_HELM ||
        helm.getItemId() === ItemId.VOID_MELEE_HELM_OR)
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
            const playerIndex = this.party.indexOf(attack.getTarget()!);
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
    this.updates = {};
    this.stageState = this.initialStageState();

    this.databaseId = extraFields.databaseId ?? -1;
    this.players =
      extraFields.players ??
      this.party.map((_) => ({ id: -1, gear: PrimaryMeleeGear.UNKNOWN }));
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
   * Returns whether every stage within the challenge has been recorded.
   */
  protected abstract hasFullyCompletedChallenge(): boolean;

  protected getDataRepository(): DataRepository {
    return this.dataRepository;
  }

  protected getPriceTracker(): PriceTracker {
    return this.priceTracker;
  }

  protected getChallengeStatus(): ChallengeStatus {
    return this.challengeStatus;
  }

  protected getStage(): Stage {
    return this.stage;
  }

  protected getParty(): string[] {
    return this.party;
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
      get: (obj: any, prop: string) => (prop in obj ? obj[prop] : 0),
    };

    if (playerIndex === -1) {
      return new Proxy({}, defaultZero);
    }

    return new Proxy(this.stageState.playerStats[playerIndex], defaultZero);
  }
}

enum ItemId {
  VOID_MELEE_HELM = 11665,
  BANDOS_CHESTPLATE = 11832,
  TORVA_PLATEBODY = 26384,
  VOID_MELEE_HELM_OR = 26477,
  BLORVA_PLATEBODY = 28256,
}
