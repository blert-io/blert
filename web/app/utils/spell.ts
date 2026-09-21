import { PlayerSpell } from '@blert/common';

export type SpellMetadata = {
  imageUrl: string;
  name: string;
  opacity?: number;
};

export const SPELL_METADATA: Record<PlayerSpell, SpellMetadata> = {
  [PlayerSpell.UNKNOWN]: {
    imageUrl: '/images/huh.png',
    name: 'Unknown Spell',
  },
  [PlayerSpell.SPELLBOOK_SWAP]: {
    imageUrl: '/images/spells/spellbook-swap.png',
    name: 'Spellbook Swap',
    opacity: 0.75,
  },
  [PlayerSpell.HUMIDIFY]: {
    imageUrl: '/images/spells/humidify.png',
    name: 'Humidify',
    opacity: 0.9,
  },
  [PlayerSpell.HUNTER_KIT]: {
    imageUrl: '/images/spells/hunter-kit.png',
    name: 'Hunter Kit',
  },
  [PlayerSpell.NPC_CONTACT]: {
    imageUrl: '/images/spells/npc-contact.png',
    name: 'NPC Contact',
  },
  [PlayerSpell.VENGEANCE]: {
    imageUrl: '/images/spells/vengeance.png',
    name: 'Vengeance',
    opacity: 0.9,
  },
  [PlayerSpell.VENGEANCE_OTHER]: {
    imageUrl: '/images/spells/vengeance-other.png',
    name: 'Vengeance Other',
  },
  [PlayerSpell.HEAL_OTHER]: {
    imageUrl: '/images/spells/heal-other.png',
    name: 'Heal Other',
  },
  [PlayerSpell.DEATH_CHARGE]: {
    imageUrl: '/images/spells/death-charge.png',
    name: 'Death Charge',
  },
  [PlayerSpell.LESSER_CORRUPTION]: {
    imageUrl: '/images/spells/lesser-corruption.png',
    name: 'Lesser Corruption',
  },
  [PlayerSpell.GREATER_CORRUPTION]: {
    imageUrl: '/images/spells/greater-corruption.png',
    name: 'Greater Corruption',
    opacity: 0.9,
  },
  [PlayerSpell.SHADOW_VEIL]: {
    imageUrl: '/images/spells/shadow-veil.png',
    name: 'Shadow Veil',
  },
  [PlayerSpell.VILE_VIGOUR]: {
    imageUrl: '/images/spells/vile-vigour.png',
    name: 'Vile Vigour',
  },
  [PlayerSpell.WARD_OF_ARCEUUS]: {
    imageUrl: '/images/spells/ward-of-arceuus.png',
    name: 'Ward of Arceuus',
  },
  [PlayerSpell.MARK_OF_DARKNESS]: {
    imageUrl: '/images/spells/mark-of-darkness.png',
    name: 'Mark of Darkness',
  },
  [PlayerSpell.RESURRECT_GREATER_GHOST]: {
    imageUrl: '/images/spells/resurrect-greater-ghost.png',
    name: 'Resurrect Greater Ghost',
  },
  [PlayerSpell.RESURRECT_GREATER_SKELETON]: {
    imageUrl: '/images/spells/resurrect-greater-skeleton.png',
    name: 'Resurrect Greater Skeleton',
  },
  [PlayerSpell.RESURRECT_GREATER_ZOMBIE]: {
    imageUrl: '/images/spells/resurrect-greater-zombie.png',
    name: 'Resurrect Greater Zombie',
  },
};
