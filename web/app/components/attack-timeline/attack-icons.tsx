import {
  BCFAttackAction,
  BCFNpcAttackAction,
  BCFSpellAction,
} from '@blert/bcf';
import { PlayerAttack, PlayerSpell } from '@blert/common';
import Image from 'next/image';

import Item from '@/components/item';
import { simpleItemCache } from '@/utils/item-cache/simple';

import {
  ATTACK_METADATA,
  bcfToNpcAttack,
  getDefaultWeaponId,
  NPC_ATTACK_METADATA,
  SPELL_METADATA,
} from './attack-metadata';

import styles from './bcf-renderer.module.scss';

const BARRAGES = new Set<PlayerAttack>([
  PlayerAttack.KODAI_BARRAGE,
  PlayerAttack.NM_STAFF_BARRAGE,
  PlayerAttack.SANG_BARRAGE,
  PlayerAttack.SCEPTRE_BARRAGE,
  PlayerAttack.SHADOW_BARRAGE,
  PlayerAttack.SOTD_BARRAGE,
  PlayerAttack.STAFF_OF_LIGHT_BARRAGE,
  PlayerAttack.TOXIC_TRIDENT_BARRAGE,
  PlayerAttack.TOXIC_STAFF_BARRAGE,
  PlayerAttack.TRIDENT_BARRAGE,
  PlayerAttack.UNKNOWN_BARRAGE,
]);

export function getAttackIcon(
  attack: BCFAttackAction,
  type: PlayerAttack,
  imageSize: number,
): React.ReactNode {
  const iconSize = imageSize / 2;

  if (BARRAGES.has(type)) {
    return (
      <Image
        className={styles.attackIcon}
        src="/images/combat/barrage.png"
        alt="Barrage"
        height={iconSize}
        width={iconSize}
      />
    );
  }

  switch (type) {
    case PlayerAttack.DARK_DEMONBANE:
      return (
        <Image
          className={styles.attackIcon}
          src="/images/combat/dark-demonbane.webp"
          alt="Dark Demonbane"
          height={iconSize}
          width={iconSize}
        />
      );
    case PlayerAttack.ICE_RUSH:
      return (
        <Image
          className={styles.attackIcon}
          src="/images/combat/ice-rush.png"
          alt="Ice Rush"
          height={iconSize + 1}
          width={iconSize + 1}
          style={{ bottom: -2 }}
        />
      );
  }

  const meta = ATTACK_METADATA[type] ?? ATTACK_METADATA[PlayerAttack.UNKNOWN];
  const isSpec =
    meta.special ||
    attack.specCost !== undefined ||
    attack.attackType.endsWith('_SPEC');
  if (isSpec) {
    return (
      <Image
        className={styles.attackIcon}
        src="/images/combat/spec.png"
        alt="Special Attack"
        height={iconSize}
        width={iconSize}
      />
    );
  }

  return undefined;
}

export const BLUNDER_STYLE: React.CSSProperties = {
  filter: 'drop-shadow(2px 4px 6px black)',
  transform: 'rotate(267deg) skewX(3.78rad)',
};

export function getWeaponImage(
  type: PlayerAttack,
  attack: BCFAttackAction,
  imageSize: number,
  outlineColor?: string,
  blunder?: boolean,
): React.ReactNode {
  const weaponId = attack.weaponId ?? getDefaultWeaponId(type);
  if (weaponId !== undefined) {
    return (
      <Item
        id={weaponId}
        name={attack.weaponName ?? simpleItemCache.getItemName(weaponId)}
        quantity={1}
        size={imageSize}
        outlineColor={outlineColor}
        style={blunder ? BLUNDER_STYLE : undefined}
      />
    );
  }

  switch (type) {
    case PlayerAttack.PUNCH:
      return (
        <Image
          src="/images/combat/punch.webp"
          alt="Punch"
          height={imageSize}
          width={imageSize}
          style={blunder ? BLUNDER_STYLE : undefined}
        />
      );
    case PlayerAttack.KICK:
      return (
        <Image
          src="/images/combat/kick.webp"
          alt="Kick"
          height={imageSize}
          width={imageSize}
          style={blunder ? BLUNDER_STYLE : undefined}
        />
      );
  }

  return (
    <Image
      src="/images/huh.png"
      alt="Unknown attack"
      height={imageSize}
      width={imageSize}
      style={blunder ? BLUNDER_STYLE : undefined}
    />
  );
}

export function getSpellImage(
  spell: BCFSpellAction,
  size: number,
): React.ReactNode {
  const spellType = PlayerSpell[spell.spellType as keyof typeof PlayerSpell];
  const meta = SPELL_METADATA[spellType];
  return (
    <Image
      src={meta.imageUrl}
      alt={meta.name}
      height={size}
      width={size}
      style={{ opacity: meta.opacity ?? 1 }}
    />
  );
}

export function getNpcAttackImage(
  attack: BCFNpcAttackAction,
  className?: string,
): React.ReactNode {
  const meta = NPC_ATTACK_METADATA[bcfToNpcAttack(attack.attackType)];
  const alt = `NPC attack: ${attack.attackType}`;
  return <Image className={className} src={meta.imageUrl} alt={alt} fill />;
}
