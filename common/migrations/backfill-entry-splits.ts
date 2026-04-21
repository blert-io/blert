import postgres from 'postgres';
import { parseArgs } from 'util';

import { ChallengeRow, ChallengeSplitRow } from '../db/challenge';
import { ChallengeStatus, ChallengeType, Stage } from '../challenge';
import { adjustSplitForMode, generalizeSplit, SplitType } from '../split';
import { dataRepositoryFromEnv } from './script-helpers';

const TOB_STAGE_ORDER: Stage[] = [
  Stage.TOB_MAIDEN,
  Stage.TOB_BLOAT,
  Stage.TOB_NYLOCAS,
  Stage.TOB_SOTETSEG,
  Stage.TOB_XARPUS,
  Stage.TOB_VERZIK,
];

const TOB_STAGE_SPLIT: Record<number, SplitType> = {
  [Stage.TOB_MAIDEN]: SplitType.TOB_MAIDEN,
  [Stage.TOB_BLOAT]: SplitType.TOB_BLOAT,
  [Stage.TOB_NYLOCAS]: SplitType.TOB_NYLO_ROOM,
  [Stage.TOB_SOTETSEG]: SplitType.TOB_SOTETSEG,
  [Stage.TOB_XARPUS]: SplitType.TOB_XARPUS,
  [Stage.TOB_VERZIK]: SplitType.TOB_VERZIK_ROOM,
};

const TOB_ENTRY_SPLIT_AFTER: Record<number, SplitType> = {
  [Stage.TOB_BLOAT]: SplitType.TOB_NYLO_START,
  [Stage.TOB_NYLOCAS]: SplitType.TOB_SOTETSEG_START,
  [Stage.TOB_SOTETSEG]: SplitType.TOB_XARPUS_START,
  [Stage.TOB_XARPUS]: SplitType.TOB_VERZIK_START,
};

type SplitRow = { type: SplitType; ticks: number; accurate: boolean };

type AccuracyPolicy = 'all-accurate' | 'party-change' | 'fallback';

type Stats = {
  challengesProcessed: number;
  challengesWithInserts: number;
  splitsInserted: number;
  byPolicy: Record<AccuracyPolicy, { challenges: number; splits: number }>;
  byType: Record<string, { challenges: number; splits: number }>;
};

function newStats(): Stats {
  return {
    challengesProcessed: 0,
    challengesWithInserts: 0,
    splitsInserted: 0,
    byPolicy: {
      'all-accurate': { challenges: 0, splits: 0 },
      'party-change': { challenges: 0, splits: 0 },
      fallback: { challenges: 0, splits: 0 },
    },
    byType: {},
  };
}

function overallGenericSplit(type: ChallengeType): SplitType | null {
  switch (type) {
    case ChallengeType.TOB:
      return SplitType.TOB_CHALLENGE;
    case ChallengeType.COLOSSEUM:
      return SplitType.COLOSSEUM_CHALLENGE;
    case ChallengeType.MOKHAIOTL:
      return SplitType.MOKHAIOTL_CHALLENGE;
    case ChallengeType.INFERNO:
      return SplitType.INFERNO_CHALLENGE;
    default:
      return null;
  }
}

function resolveAccuracyPolicy(
  challenge: ChallengeRow,
  byGeneric: Map<SplitType, SplitRow>,
): AccuracyPolicy {
  const overallType = overallGenericSplit(challenge.type);
  if (overallType === null) {
    return 'fallback';
  }
  const overall = byGeneric.get(overallType);
  if (overall?.accurate === true) {
    return 'all-accurate';
  }
  if (
    overall !== undefined &&
    challenge.status === ChallengeStatus.COMPLETED &&
    challenge.full_recording
  ) {
    return 'party-change';
  }
  return 'fallback';
}

function resolveEntryAccuracy(
  policy: AccuracyPolicy,
  cumulativeAccurate: boolean,
): boolean {
  switch (policy) {
    case 'all-accurate':
      return true;
    case 'party-change':
      return false;
    case 'fallback':
      return cumulativeAccurate;
  }
}

async function backfillTobChallenge(
  sql: postgres.Sql,
  challenge: ChallengeRow,
  splits: SplitRow[],
  dryRun: boolean,
): Promise<{ inserted: number; policy: AccuracyPolicy }> {
  const byGeneric = new Map<SplitType, SplitRow>();
  for (const split of splits) {
    byGeneric.set(generalizeSplit(split.type), split);
  }

  const policy = resolveAccuracyPolicy(challenge, byGeneric);

  const toInsert: SplitRow[] = [];
  let cumulativeTicks = 0;
  let cumulativeAccurate = true;

  for (const stage of TOB_STAGE_ORDER) {
    const stageSplit = byGeneric.get(TOB_STAGE_SPLIT[stage]);
    if (stageSplit === undefined) {
      break;
    }

    cumulativeTicks += stageSplit.ticks;
    cumulativeAccurate = cumulativeAccurate && stageSplit.accurate;

    const entrySplit = TOB_ENTRY_SPLIT_AFTER[stage];
    if (entrySplit !== undefined && !byGeneric.has(entrySplit)) {
      toInsert.push({
        type: adjustSplitForMode(entrySplit, challenge.mode),
        ticks: cumulativeTicks,
        accurate: resolveEntryAccuracy(policy, cumulativeAccurate),
      });
    }
  }

  const inserted = await insertSplits(
    sql,
    challenge.id,
    challenge.scale,
    toInsert,
    dryRun,
  );
  return { inserted, policy };
}

async function backfillColosseumChallenge(
  sql: postgres.Sql,
  challenge: ChallengeRow,
  splits: SplitRow[],
  dryRun: boolean,
): Promise<{ inserted: number; policy: AccuracyPolicy }> {
  const byType = new Map<SplitType, SplitRow>();
  for (const split of splits) {
    byType.set(split.type, split);
  }

  const policy = resolveAccuracyPolicy(challenge, byType);

  const toInsert: SplitRow[] = [];
  let cumulativeTicks = 0;
  let cumulativeAccurate = true;

  for (let wave = 1; wave <= 12; wave++) {
    const waveSplit = byType.get(SplitType.COLOSSEUM_WAVE_1 + (wave - 1));
    if (waveSplit === undefined) {
      break;
    }

    cumulativeTicks += waveSplit.ticks;
    cumulativeAccurate = cumulativeAccurate && waveSplit.accurate;

    if (wave >= 2 && wave < 12) {
      const entrySplit = SplitType.COLOSSEUM_WAVE_3_START + (wave - 2);
      if (!byType.has(entrySplit)) {
        toInsert.push({
          type: entrySplit,
          ticks: cumulativeTicks,
          accurate: resolveEntryAccuracy(policy, cumulativeAccurate),
        });
      }
    }
  }

  const inserted = await insertSplits(
    sql,
    challenge.id,
    challenge.scale,
    toInsert,
    dryRun,
  );
  return { inserted, policy };
}

async function backfillMokhaiotlChallenge(
  sql: postgres.Sql,
  challenge: ChallengeRow,
  splits: SplitRow[],
  dryRun: boolean,
): Promise<{ inserted: number; policy: AccuracyPolicy }> {
  const byType = new Map<SplitType, SplitRow>();
  for (const split of splits) {
    byType.set(split.type, split);
  }

  const policy = resolveAccuracyPolicy(challenge, byType);

  const toInsert: SplitRow[] = [];
  let cumulativeTicks = 0;
  let cumulativeAccurate = true;

  for (let delve = 1; delve <= 8; delve++) {
    const delveSplit = byType.get(SplitType.MOKHAIOTL_DELVE_1 + (delve - 1));
    if (delveSplit === undefined) {
      break;
    }

    cumulativeTicks += delveSplit.ticks;
    cumulativeAccurate = cumulativeAccurate && delveSplit.accurate;

    if (delve >= 2 && delve < 8) {
      const entrySplit = SplitType.MOKHAIOTL_DELVE_3_START + (delve - 2);
      if (!byType.has(entrySplit)) {
        toInsert.push({
          type: entrySplit,
          ticks: cumulativeTicks,
          accurate: resolveEntryAccuracy(policy, cumulativeAccurate),
        });
      }
    }
  }

  const inserted = await insertSplits(
    sql,
    challenge.id,
    challenge.scale,
    toInsert,
    dryRun,
  );
  return { inserted, policy };
}

async function backfillInfernoChallenge(
  sql: postgres.Sql,
  challenge: ChallengeRow,
  splits: SplitRow[],
  dryRun: boolean,
  dataRepository: ReturnType<typeof dataRepositoryFromEnv>,
): Promise<{ inserted: number; policy: AccuracyPolicy }> {
  const byType = new Map<SplitType, SplitRow>();
  for (const split of splits) {
    byType.set(split.type, split);
  }

  const policy = resolveAccuracyPolicy(challenge, byType);

  let infernoData;
  try {
    infernoData = await dataRepository.loadInfernoChallengeData(challenge.uuid);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(
      `Challenge ${challenge.uuid}: failed to load inferno data: ${message}`,
    );
    return { inserted: 0, policy };
  }

  const toInsert: SplitRow[] = [];
  for (const wave of infernoData.waves) {
    const waveNumber = wave.stage - Stage.INFERNO_WAVE_1 + 1;
    if (waveNumber < 1 || waveNumber > 69) {
      continue;
    }
    const type = SplitType.INFERNO_WAVE_1_TIME + (waveNumber - 1);
    if (byType.has(type)) {
      continue;
    }
    toInsert.push({
      type,
      ticks: wave.ticks,
      accurate: resolveEntryAccuracy(policy, false),
    });
  }

  const inserted = await insertSplits(
    sql,
    challenge.id,
    challenge.scale,
    toInsert,
    dryRun,
  );
  return { inserted, policy };
}

async function insertSplits(
  sql: postgres.Sql,
  challengeId: number,
  scale: number,
  splits: SplitRow[],
  dryRun: boolean,
): Promise<number> {
  if (splits.length === 0) {
    return 0;
  }

  if (dryRun) {
    return splits.length;
  }

  const rows = splits.map((s) => ({
    challenge_id: challengeId,
    type: s.type,
    scale,
    ticks: s.ticks,
    accurate: s.accurate,
  }));

  const result = await sql`
    INSERT INTO challenge_splits ${sql(
      rows,
      'challenge_id',
      'type',
      'scale',
      'ticks',
      'accurate',
    )}
    ON CONFLICT (challenge_id, type) DO NOTHING
  `;

  return result.count;
}

function recordResult(
  stats: Stats,
  challenge: ChallengeRow,
  inserted: number,
  policy: AccuracyPolicy,
) {
  stats.challengesProcessed += 1;
  if (inserted === 0) {
    return;
  }
  stats.challengesWithInserts += 1;
  stats.splitsInserted += inserted;
  stats.byPolicy[policy].challenges += 1;
  stats.byPolicy[policy].splits += inserted;

  const typeName = ChallengeType[challenge.type] ?? 'UNKNOWN';
  if (!(typeName in stats.byType)) {
    stats.byType[typeName] = { challenges: 0, splits: 0 };
  }
  stats.byType[typeName].challenges += 1;
  stats.byType[typeName].splits += inserted;
}

function printStats(stats: Stats, dryRun: boolean) {
  const verb = dryRun ? 'would insert' : 'inserted';
  console.log('');
  console.log(`Challenges processed: ${stats.challengesProcessed}`);
  console.log(
    `Challenges with new splits: ${stats.challengesWithInserts} ` +
      `(${verb} ${stats.splitsInserted} splits total)`,
  );

  console.log('');
  console.log('By accuracy policy:');
  for (const policy of [
    'all-accurate',
    'party-change',
    'fallback',
  ] as AccuracyPolicy[]) {
    const { challenges, splits } = stats.byPolicy[policy];
    console.log(
      `  ${policy.padEnd(14)} ${challenges.toString().padStart(6)} challenges, ${splits.toString().padStart(6)} splits`,
    );
  }

  console.log('');
  console.log('By challenge type:');
  for (const [type, { challenges, splits }] of Object.entries(stats.byType)) {
    console.log(
      `  ${type.padEnd(14)} ${challenges.toString().padStart(6)} challenges, ${splits.toString().padStart(6)} splits`,
    );
  }
}

export async function scriptMain(sql: postgres.Sql, args: string[]) {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'batch-size': { type: 'string', default: '200' },
      'start-id': { type: 'string' },
      'end-id': { type: 'string' },
    },
    args,
  });

  const dryRun = values['dry-run'] ?? false;
  const batchSize = parseInt(values['batch-size']);
  const startId = values['start-id'] ? parseInt(values['start-id']) : 0;
  const endId = values['end-id'] ? parseInt(values['end-id']) : undefined;

  const dataRepository = dataRepositoryFromEnv();
  const stats = newStats();

  let lastId = startId - 1;

  while (true) {
    const challenges = await sql<ChallengeRow[]>`
      SELECT *
      FROM challenges
      WHERE id > ${lastId}
      ${endId !== undefined ? sql`AND id <= ${endId}` : sql``}
      ORDER BY id ASC
      LIMIT ${batchSize}
    `;

    if (challenges.length === 0) {
      break;
    }

    const challengeIds = challenges.map((c) => c.id);
    const allSplits = await sql<ChallengeSplitRow[]>`
      SELECT *
      FROM challenge_splits
      WHERE challenge_id = ANY(${challengeIds})
    `;

    const splitsByChallengeId = new Map<number, SplitRow[]>();
    for (const split of allSplits) {
      if (!splitsByChallengeId.has(split.challenge_id)) {
        splitsByChallengeId.set(split.challenge_id, []);
      }
      splitsByChallengeId.get(split.challenge_id)!.push({
        type: split.type,
        ticks: split.ticks,
        accurate: split.accurate,
      });
    }

    for (const challenge of challenges) {
      const splits = splitsByChallengeId.get(challenge.id) ?? [];
      let result: { inserted: number; policy: AccuracyPolicy } = {
        inserted: 0,
        policy: 'fallback',
      };

      switch (challenge.type) {
        case ChallengeType.TOB:
          result = await backfillTobChallenge(sql, challenge, splits, dryRun);
          break;
        case ChallengeType.COLOSSEUM:
          result = await backfillColosseumChallenge(
            sql,
            challenge,
            splits,
            dryRun,
          );
          break;
        case ChallengeType.MOKHAIOTL:
          result = await backfillMokhaiotlChallenge(
            sql,
            challenge,
            splits,
            dryRun,
          );
          break;
        case ChallengeType.INFERNO:
          result = await backfillInfernoChallenge(
            sql,
            challenge,
            splits,
            dryRun,
            dataRepository,
          );
          break;
        default:
          stats.challengesProcessed += 1;
          continue;
      }

      recordResult(stats, challenge, result.inserted, result.policy);
    }

    lastId = challenges[challenges.length - 1].id;
    console.log(
      `Progress: ${stats.challengesProcessed} challenges, ${stats.splitsInserted} splits (last id=${lastId})`,
    );
  }

  printStats(stats, dryRun);
}
