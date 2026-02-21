import { EventType } from '../event';
import { ChallengeMode, Stage } from '../challenge';
import { CamelToSnakeCase } from '../translate';

export type QueryableEvent = {
  eventType: EventType;
  stage: Stage;
  mode: ChallengeMode;
  tick: number;
  xCoord: number;
  yCoord: number;
  subtype: number | null;
  playerId: number | null;
  npcId: number | null;
  customInt1: number | null;
  customInt2: number | null;
  customShort1: number | null;
  customShort2: number | null;
};

export type QueryableEventRow = CamelToSnakeCase<QueryableEvent> & {
  challenge_id: number;
};

export const QueryableEventField = {
  PLAYER_ATTACK_WEAPON: 'custom_int_1',
  PLAYER_ATTACK_DISTANCE: 'custom_short_1',

  PLAYER_SPELL_TARGET_PLAYER: 'custom_short_1',

  NPC_MAIDEN_CRAB_SPAWN: 'custom_short_1',
  NPC_MAIDEN_CRAB_POSITION: 'custom_short_2',
  NPC_NYLO_SPAWN_TYPE: 'custom_short_1',
  NPC_NYLO_STYLE: 'custom_short_2',
  NPC_VERZIK_CRAB_PHASE: 'custom_short_1',
  NPC_VERZIK_CRAB_SPAWN: 'custom_short_2',

  TOB_MAIDEN_CRAB_LEAK_SPAWN: 'custom_short_1',
  TOB_MAIDEN_CRAB_LEAK_POSITION: 'custom_short_2',
  TOB_MAIDEN_CRAB_LEAK_CURRENT_HP: 'custom_int_1',
  TOB_MAIDEN_CRAB_LEAK_BASE_HP: 'custom_int_2',

  TOB_BLOAT_DOWN_NUMBER: 'custom_short_1',
  TOB_BLOAT_DOWN_WALK_TIME: 'custom_short_2',

  TOB_NYLO_WAVE_NUMBER: 'custom_short_1',
  TOB_NYLO_WAVE_NYLO_COUNT: 'custom_short_2',

  SOL_GRAPPLE_TARGET: 'custom_short_1',
  SOL_GRAPPLE_OUTCOME: 'custom_short_2',
} as const;
