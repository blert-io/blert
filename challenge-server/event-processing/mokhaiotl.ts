import {
  AttackStyle,
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  DataRepository,
  MokhaiotlData,
  NpcAttack,
  PriceTracker,
  SplitType,
  Stage,
  StageStatus,
} from '@blert/common';
import { Event, NpcAttackMap } from '@blert/common/generated/event_pb';

import ChallengeProcessor, { InitializedFields } from './challenge-processor';
import sql from '../db';
import logger from '../log';
import { MergedEvents } from '../merging';

type DelveState = {
  larvaeLeaked: number;
};

type CustomData = {
  mokhaiotlData: MokhaiotlData;
  delve1To8Ticks: number | null;
};

export default class MokhaiotlProcessor extends ChallengeProcessor {
  private mokhaiotlData: MokhaiotlData;
  private delveState: DelveState;
  private delve1To8Ticks: number | null;

  constructor(
    dataRepository: DataRepository,
    priceTracker: PriceTracker,
    uuid: string,
    mode: ChallengeMode,
    stage: Stage,
    stageStatus: StageStatus,
    party: string[],
    extraFields: InitializedFields = {},
  ) {
    super(
      dataRepository,
      priceTracker,
      ChallengeType.MOKHAIOTL,
      Stage.MOKHAIOTL_DELVE_1,
      Stage.MOKHAIOTL_DELVE_8,
      uuid,
      mode,
      stage,
      stageStatus,
      party,
      extraFields,
    );

    this.delveState = {
      larvaeLeaked: 0,
    };

    if (extraFields.customData) {
      const customData = extraFields.customData as CustomData;
      this.mokhaiotlData = customData.mokhaiotlData;
      this.delve1To8Ticks = customData.delve1To8Ticks;
    } else {
      this.mokhaiotlData = { delves: [] };
      this.delve1To8Ticks = null;
    }
  }

  protected async onCreate(): Promise<void> {
    await Promise.all([
      sql`
        INSERT INTO mokhaiotl_challenge_stats (challenge_id, delve)
        VALUES (${this.getDatabaseId()}, ${this.getDelve()})
      `,
      this.getDataRepository().saveMokhaiotlChallengeData(
        this.getUuid(),
        this.mokhaiotlData,
      ),
    ]);
  }

  protected override getFinalChallengeTicks(): number {
    return this.delve1To8Ticks ?? this.getTotalChallengeTicks();
  }

  protected override onFinish(finalChallengeTicks: number): Promise<void> {
    this.setSplit(SplitType.MOKHAIOTL_CHALLENGE, finalChallengeTicks);

    for (const username of this.getParty()) {
      const stats = this.getCurrentStageStats(username);
      switch (this.getChallengeStatus()) {
        case ChallengeStatus.COMPLETED:
          stats.mokhaiotlCompletions += 1;
          break;
        case ChallengeStatus.RESET:
          stats.mokhaiotlResets += 1;
          break;
        case ChallengeStatus.WIPED:
          stats.mokhaiotlWipes += 1;
          break;
      }
    }

    return Promise.resolve();
  }

  protected override async onStageFinished(
    stage: Stage,
    events: MergedEvents,
  ): Promise<void> {
    if (stage !== Stage.MOKHAIOTL_DELVE_8PLUS) {
      if (stage === Stage.MOKHAIOTL_DELVE_8) {
        this.delve1To8Ticks = this.getTotalChallengeTicks();
      }
      const index = stage - Stage.MOKHAIOTL_DELVE_1;
      this.setSplit(SplitType.MOKHAIOTL_DELVE_1 + index, events.getLastTick());
    }

    const delve = this.getDelve();

    for (const username of this.getParty()) {
      const stats = this.getCurrentStageStats(username);
      stats.mokhaiotlTotalDelves += 1;
      if (events.getStatus() === StageStatus.COMPLETED) {
        stats.mokhaiotlDelvesCompleted += 1;
        if (delve >= 8) {
          stats.mokhaiotlDeepDelvesCompleted += 1;
        }
      }
    }

    const state = this.getStageState();
    this.mokhaiotlData.delves.push({
      stage,
      ticksLost: events.getMissingTickCount(),
      npcs: Object.fromEntries(state?.npcs ?? []),
      delve,
      challengeTicks: events.getLastTick(),
      larvaeLeaked: this.delveState.larvaeLeaked,
    });

    await Promise.all([
      this.updateChallengeStats(
        delve,
        this.delveState.larvaeLeaked,
        events.getStatus() === StageStatus.COMPLETED ? delve : undefined,
      ),
      this.getDataRepository().saveMokhaiotlChallengeData(
        this.getUuid(),
        this.mokhaiotlData,
      ),
    ]);
  }

  protected override processChallengeEvent(
    allEvents: MergedEvents,
    event: Event,
  ): Promise<boolean> {
    switch (event.getType()) {
      case Event.Type.MOKHAIOTL_ATTACK_STYLE: {
        // Update the previously-written NPC_ATTACK event.
        const mokhaiotlAttackStyle = event.getMokhaiotlAttackStyle()!;

        const attackEvent = allEvents
          .eventsForTick(mokhaiotlAttackStyle.getNpcAttackTick())
          .find((e) => {
            if (e.getType() !== Event.Type.NPC_ATTACK) {
              return false;
            }
            const attack = e.getNpcAttack()!.getAttack();
            return (
              attack === NpcAttack.MOKHAIOTL_AUTO ||
              attack === NpcAttack.MOKHAIOTL_BALL
            );
          });

        if (attackEvent === undefined) {
          logger.warn(
            `Challenge ${this.getUuid()} got MOKHAIOTL_ATTACK_STYLE without a matching NPC_ATTACK`,
          );
          return Promise.resolve(false);
        }

        const npcAttack = attackEvent.getNpcAttack()!;
        let attackType: NpcAttack = npcAttack.getAttack();

        if (npcAttack.getAttack() === NpcAttack.MOKHAIOTL_BALL) {
          if (mokhaiotlAttackStyle.getStyle() === AttackStyle.RANGE) {
            attackType = NpcAttack.MOKHAIOTL_RANGED_BALL;
          } else if (mokhaiotlAttackStyle.getStyle() === AttackStyle.MAGE) {
            attackType = NpcAttack.MOKHAIOTL_MAGE_BALL;
          }
        } else {
          if (mokhaiotlAttackStyle.getStyle() === AttackStyle.MELEE) {
            attackType = NpcAttack.MOKHAIOTL_MELEE_AUTO;
          } else if (mokhaiotlAttackStyle.getStyle() === AttackStyle.RANGE) {
            attackType = NpcAttack.MOKHAIOTL_RANGED_AUTO;
          } else if (mokhaiotlAttackStyle.getStyle() === AttackStyle.MAGE) {
            attackType = NpcAttack.MOKHAIOTL_MAGE_AUTO;
          }
        }

        npcAttack.setAttack(attackType as NpcAttackMap[keyof NpcAttackMap]);

        // The MOKHAIOTL_ATTACK_STYLE event should not be written.
        return Promise.resolve(false);
      }

      case Event.Type.MOKHAIOTL_LARVA_LEAK: {
        this.delveState.larvaeLeaked += 1;
        break;
      }
    }

    return Promise.resolve(true);
  }

  protected override getCustomData(): CustomData | null {
    return {
      mokhaiotlData: this.mokhaiotlData,
      delve1To8Ticks: this.delve1To8Ticks,
    };
  }

  protected override hasFullyRecordedUpTo(stage: Stage): boolean {
    if (
      stage < Stage.MOKHAIOTL_DELVE_1 ||
      stage > Stage.MOKHAIOTL_DELVE_8PLUS
    ) {
      return false;
    }

    const recordedStages = new Set(
      this.mokhaiotlData.delves.map((delve) => delve.stage),
    );

    for (let s = Stage.MOKHAIOTL_DELVE_1; s <= stage; s++) {
      if (!recordedStages.has(s)) {
        return false;
      }
    }

    return true;
  }

  protected override isRetriable(stage: Stage): boolean {
    return stage === Stage.MOKHAIOTL_DELVE_8PLUS;
  }

  private async updateChallengeStats(
    delve: number,
    additionalLarvaeLeaked: number,
    maxCompletedDelve?: number,
  ): Promise<void> {
    const updates: Record<string, any> = {
      delve,
      larvae_leaked: sql`larvae_leaked + ${additionalLarvaeLeaked}`,
    };
    if (maxCompletedDelve) {
      updates.max_completed_delve = maxCompletedDelve;
    }

    await sql`
      UPDATE mokhaiotl_challenge_stats
      SET ${sql(updates)}
      WHERE challenge_id = ${this.getDatabaseId()};
    `;
  }

  private getDelve(): number {
    if (this.getStage() === Stage.MOKHAIOTL_DELVE_8PLUS) {
      return 8 + (this.getStageAttempt() ?? 1);
    }
    const index = this.getStage() - Stage.MOKHAIOTL_DELVE_1;
    return index + 1;
  }
}
