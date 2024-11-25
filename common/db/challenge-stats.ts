import { CamelToSnakeCase } from '../translate';

export type TobChallengeStats = {
  maidenDeaths: number;
  maidenFullLeaks: number | null;
  maidenScuffedSpawns: boolean;
  bloatDeaths: number;
  bloatFirstDownHpPercent: number | null;
  nylocasDeaths: number;
  nylocasPreCapStalls: number | null;
  nylocasPostCapStalls: number | null;
  nylocasStalls: number[];
  nylocasMageSplits: number;
  nylocasRangedSplits: number;
  nylocasMeleeSplits: number;
  nylocasBossMage: number;
  nylocasBossRanged: number;
  nylocasBossMelee: number;
  sotetsegDeaths: number;
  xarpusDeaths: number;
  xarpusHealing: number | null; // TODO(frolv): This is not yet tracked.
  verzikDeaths: number;
  verzikRedsCount: number | null;
};

export type TobChallengeStatsRow = CamelToSnakeCase<TobChallengeStats> & {
  challenge_id: number;
};
