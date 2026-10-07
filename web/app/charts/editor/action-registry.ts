import { BCFAction, BCFAttackAction } from '@blert/bcf';

import {
  CombatStyle,
  bcfToPlayerAttack,
  getActionMetadata,
  getAttackStyle,
} from '@/components/attack-timeline';

import { attackCooldown } from './attack-cycle';

export type ActionTab = 'attack' | 'spell' | 'utility' | 'npcAttack';

/** An action that can be placed in the editor. */
export type ActionEntry = {
  key: string;
  tab: ActionTab;
  action: BCFAction;
  name: string;
  aliases: string[];
  imageUrl?: string;
  style: CombatStyle | null;
  cooldown: number;
};

/** Groups of attacks that `S` cycles through. */
const ATTACKS: { type: string; name: string; aliases?: string[] }[][] = [
  [{ type: 'SCYTHE', name: 'Scythe' }],
  [{ type: 'TWISTED_BOW', name: 'Twisted bow', aliases: ['tbow'] }],
  [{ type: 'BLOWPIPE', name: 'Blowpipe', aliases: ['bp', 'pipe'] }],
  [{ type: 'EYE_OF_AYAK_AUTO', name: 'Ayak' }],
  [
    { type: 'CLAW_SCRATCH', name: 'Claw scratch' },
    { type: 'CLAW_SPEC', name: 'Claw spec' },
  ],
  [{ type: 'ELDER_MAUL_SPEC', name: 'Maul spec' }],
  [{ type: 'BGS_SPEC', name: 'BGS spec' }],
  [{ type: 'TONALZTICS_SPEC', name: 'Ralos spec' }],
  [
    { type: 'DAWN_SPEC', name: 'Dawnbringer' },
    { type: 'DAWN_AUTO', name: 'Dawn auto' },
  ],
  [{ type: 'CHALLY_SPEC', name: 'Chally' }],
];

const SPELLS: { type: string; aliases?: string[] }[] = [
  { type: 'HUMIDIFY' },
  { type: 'SPELLBOOK_SWAP' },
  { type: 'HUNTER_KIT' },
  { type: 'VENGEANCE' },
  { type: 'VENGEANCE_OTHER' },
  { type: 'RESURRECT_GREATER_GHOST', aliases: ['thrall'] },
];

const UTILITIES: { type: string; aliases?: string[] }[] = [
  { type: 'SURGE_POTION' },
];

const NPC_ATTACKS: { type: string; name: string; aliases?: string[] }[] = [
  { type: 'TOB_VERZIK_P1_AUTO', name: 'Verzik P1 auto' },
];

/** Returns a unique identifier for an action. */
export function actionKey(action: BCFAction): string {
  switch (action.type) {
    case 'attack':
    case 'npcAttack':
      return `${action.type}:${action.attackType}`;
    case 'spell':
      return `spell:${action.spellType}`;
    case 'utility':
      return `utility:${action.utilityType}`;
    case 'npcPhase':
      return `npcPhase:${action.phaseType}`;
    case 'death':
      return 'death';
  }
}

function entry(
  tab: ActionTab,
  action: BCFAction,
  { name, aliases = [] }: { name?: string; aliases?: string[] },
): ActionEntry {
  const metadata = getActionMetadata(action);
  return {
    key: actionKey(action),
    tab,
    name: name ?? metadata.name,
    aliases,
    imageUrl: metadata.imageUrl,
    action,
    style: null,
    cooldown: 1,
  };
}

function attackEntry(row: {
  type: string;
  name: string;
  aliases?: string[];
}): ActionEntry {
  const { type } = row;
  const action: BCFAttackAction = { type: 'attack', attackType: type };
  return {
    ...entry('attack', action, row),
    style: getAttackStyle(bcfToPlayerAttack(type)),
    cooldown: attackCooldown(type),
  };
}

export const ACTION_ENTRIES: ActionEntry[] = [
  ...ATTACKS.flat().map(attackEntry),
  ...SPELLS.map((row) =>
    entry('spell', { type: 'spell', spellType: row.type }, row),
  ),
  ...UTILITIES.map((row) =>
    entry('utility', { type: 'utility', utilityType: row.type }, row),
  ),
  ...NPC_ATTACKS.map((row) =>
    entry('npcAttack', { type: 'npcAttack', attackType: row.type }, row),
  ),
];

/** Returns a readable name for an action. */
export function actionName(action: BCFAction): string {
  const key = actionKey(action);
  return (
    ACTION_ENTRIES.find((e) => e.key === key)?.name ??
    getActionMetadata(action).name
  );
}

/** Returns the attack `step` steps from `action` in its cycle, if any. */
export function cycleAttack(
  action: BCFAction,
  step: 1 | -1,
): BCFAttackAction | null {
  if (action.type !== 'attack') {
    return null;
  }

  const group = ATTACKS.find((g) =>
    g.some((a) => a.type === action.attackType),
  );
  if (group === undefined || group.length < 2) {
    return null;
  }

  const index = group.findIndex((a) => a.type === action.attackType);
  return {
    type: 'attack',
    attackType: group[(index + step + group.length) % group.length].type,
  };
}

/**
 * Returns the entries whose names or aliases contain `query`, ignoring case,
 * with exact alias matches first.
 */
export function filterEntries(
  entries: ActionEntry[],
  query: string,
): ActionEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return entries;
  }

  const exact: ActionEntry[] = [];
  const partial: ActionEntry[] = [];
  for (const e of entries) {
    const aliases = e.aliases.map((a) => a.toLowerCase());
    if (aliases.includes(needle)) {
      exact.push(e);
    } else if (
      e.name.toLowerCase().includes(needle) ||
      aliases.some((a) => a.includes(needle))
    ) {
      partial.push(e);
    }
  }
  return [...exact, ...partial];
}
