import {
  BCFAction,
  BCFAttackAction,
  BCFCell,
  BCFNpcAttackAction,
  BCFSpellAction,
} from '@blert/bcf';
import { PlayerAttack, PlayerSpell } from '@blert/common';

import { getItemImageUrl } from '@/utils/item';
import { simpleItemCache } from '@/utils/item-cache/simple';

import {
  ATTACK_METADATA,
  bcfToNpcAttack,
  bcfToPlayerAttack,
  getDefaultWeaponId,
  NPC_ATTACK_METADATA,
  SPELL_METADATA,
} from '../attack-metadata';
import { CustomState } from '../types';

import { BLERT_PURPLE, TEXT_PRIMARY } from './colors';
import { ImageCache } from './image-cache';
import { BoundingBox, Point } from './types';

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

function weaponImageUrl(type: PlayerAttack, attack: BCFAttackAction): string {
  const weaponId = attack.weaponId ?? getDefaultWeaponId(type);
  if (weaponId !== undefined) {
    const name = attack.weaponName ?? simpleItemCache.getItemName(weaponId);
    return getItemImageUrl(weaponId, name, 1);
  }

  switch (type) {
    case PlayerAttack.PUNCH:
      return '/images/combat/punch.webp';
    case PlayerAttack.KICK:
      return '/images/combat/kick.webp';
    default:
      return '/images/huh.png';
  }
}

function attackOverlayUrl(
  attack: BCFAttackAction,
  type: PlayerAttack,
): string | undefined {
  if (BARRAGES.has(type)) {
    return '/images/combat/barrage.png';
  }

  switch (type) {
    case PlayerAttack.DARK_DEMONBANE:
      return '/images/combat/dark-demonbane.webp';
    case PlayerAttack.ICE_RUSH:
      return '/images/combat/ice-rush.png';
  }

  const meta = ATTACK_METADATA[type] ?? ATTACK_METADATA[PlayerAttack.UNKNOWN];
  const isSpec =
    meta.special ||
    attack.specCost !== undefined ||
    attack.attackType.endsWith('_SPEC');
  if (isSpec) {
    return '/images/combat/spec.png';
  }

  return undefined;
}

function spellMeta(spell: BCFSpellAction) {
  const type = PlayerSpell[spell.spellType as keyof typeof PlayerSpell];
  return SPELL_METADATA[type];
}

/** Draws an image scaled to fit within a box, preserving aspect ratio. */
function drawContainedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  box: BoundingBox,
): void {
  const scale = Math.min(
    box.width / img.naturalWidth,
    box.height / img.naturalHeight,
  );
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(
    img,
    box.x + (box.width - w) / 2,
    box.y + (box.height - h) / 2,
    w,
    h,
  );
}

/** Draws an image from the cache. Returns `true` if the image was drawn. */
function drawCachedImage(
  ctx: CanvasRenderingContext2D,
  imageCache: ImageCache,
  url: string,
  box: BoundingBox,
  alpha?: number,
): boolean {
  const img = imageCache.get(url);
  if (img === undefined) {
    return false;
  }

  if (alpha !== undefined) {
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = alpha;
    drawContainedImage(ctx, img, box);
    ctx.globalAlpha = prev;
  } else {
    drawContainedImage(ctx, img, box);
  }

  return true;
}

/** Draws a small text label at the given position. */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  pos: Point,
  fontSize: number,
  color: string = TEXT_PRIMARY,
): void {
  ctx.font = `bold ${fontSize}px 'Plus Jakarta Sans', sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, pos.x, pos.y);
}

// Blunder transform constants.
const BLUNDER_ROTATION = (267 * Math.PI) / 180; // 267deg in radians
const BLUNDER_SKEW = Math.tan(3.78); // skewX(3.78rad)

/** Draws a weapon image with blunder styling. */
function drawBlunderImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  pos: Point,
  size: number,
  cellSize: number,
): void {
  ctx.save();

  // Clip to cell bounds so the rotated/skewed image doesn't overflow.
  ctx.beginPath();
  ctx.rect(pos.x - 1, pos.y - 1, cellSize + 2, cellSize + 2);
  ctx.clip();

  // Draw slightly smaller to reduce clipping impact.
  const drawSize = size - 2;
  const cx = pos.x + cellSize / 2;
  const cy = pos.y + cellSize / 2;

  ctx.translate(cx, cy);
  ctx.rotate(BLUNDER_ROTATION);
  ctx.transform(1, 0, BLUNDER_SKEW, 1, 0, 0);

  ctx.shadowColor = 'black';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 4;

  ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);

  ctx.restore();
}

/** Draws a weapon with an inventory tag outline. */
function drawWeaponWithTag(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  box: BoundingBox,
  tagColor: string,
): void {
  ctx.save();
  ctx.shadowColor = tagColor;
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 2;
  drawContainedImage(ctx, img, box);
  ctx.shadowOffsetX = -1;
  ctx.shadowOffsetY = -1;
  drawContainedImage(ctx, img, box);
  ctx.restore();
}

function drawWeapon(
  ctx: CanvasRenderingContext2D,
  pos: Point,
  cellSize: number,
  imageCache: ImageCache,
  attack: BCFAttackAction,
  attackType: PlayerAttack,
  blunder: boolean,
  showInventoryTags: boolean,
): boolean {
  const url = weaponImageUrl(attackType, attack);
  const img = imageCache.get(url);
  if (img === undefined) {
    return false;
  }

  const imageSize = cellSize - 2;

  if (blunder) {
    drawBlunderImage(ctx, img, pos, imageSize, cellSize);
  } else if (showInventoryTags) {
    const meta =
      ATTACK_METADATA[attackType] ?? ATTACK_METADATA[PlayerAttack.UNKNOWN];
    const imgBox: BoundingBox = {
      x: pos.x + 1,
      y: pos.y + 1,
      width: imageSize,
      height: imageSize,
    };
    if (meta.tagColor !== undefined) {
      drawWeaponWithTag(ctx, img, imgBox, meta.tagColor);
    } else {
      drawContainedImage(ctx, img, imgBox);
    }
  } else {
    drawContainedImage(ctx, img, {
      x: pos.x + 1,
      y: pos.y + 1,
      width: imageSize,
      height: imageSize,
    });
  }

  return true;
}

function drawAttackOverlay(
  ctx: CanvasRenderingContext2D,
  pos: Point,
  cellSize: number,
  imageCache: ImageCache,
  attack: BCFAttackAction,
  attackType: PlayerAttack,
): boolean {
  const url = attackOverlayUrl(attack, attackType);
  if (url === undefined) {
    return true;
  }
  const size = Math.floor((cellSize - 2) / 2);
  return drawCachedImage(ctx, imageCache, url, {
    x: pos.x + cellSize - size,
    y: pos.y + cellSize - size,
    width: size,
    height: size,
  });
}

/** Draws a spell full-cell spell image. */
function drawSpellBase(
  ctx: CanvasRenderingContext2D,
  pos: Point,
  cellSize: number,
  imageCache: ImageCache,
  spell: BCFSpellAction,
): boolean {
  const meta = spellMeta(spell);
  const s = cellSize - 2;
  return drawCachedImage(
    ctx,
    imageCache,
    meta.imageUrl,
    { x: pos.x + 1, y: pos.y + 1, width: s, height: s },
    meta.opacity !== undefined && meta.opacity < 1 ? meta.opacity : undefined,
  );
}

function drawSpellOverlay(
  ctx: CanvasRenderingContext2D,
  pos: Point,
  cellSize: number,
  imageCache: ImageCache,
  spell: BCFSpellAction,
): boolean {
  const meta = spellMeta(spell);
  const size = Math.floor(cellSize / 2) + 1;
  return drawCachedImage(
    ctx,
    imageCache,
    meta.imageUrl,
    {
      x: pos.x,
      y: pos.y + cellSize - size,
      width: size,
      height: size,
    },
    meta.opacity !== undefined && meta.opacity < 1 ? meta.opacity : undefined,
  );
}

function drawLetterMode(
  ctx: CanvasRenderingContext2D,
  pos: Point,
  cellSize: number,
  attackType: PlayerAttack,
): void {
  const meta =
    ATTACK_METADATA[attackType] ?? ATTACK_METADATA[PlayerAttack.UNKNOWN];
  const fontSize = Math.floor(cellSize / 2);

  ctx.font = `bold ${fontSize}px 'Plus Jakarta Sans', sans-serif`;
  ctx.fillStyle = meta.tagColor ?? TEXT_PRIMARY;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(meta.letter, pos.x + cellSize / 2, pos.y + cellSize / 2);
}

function createDamageCustomState(
  attack: BCFAttackAction,
): CustomState | undefined {
  if (attack.damage === undefined) {
    return undefined;
  }

  let weaponName = attack.weaponName;
  if (weaponName === undefined && attack.weaponId !== undefined) {
    weaponName = simpleItemCache.getItemName(attack.weaponId);
  }

  return {
    label: attack.damage.toString(),
    fullText: weaponName
      ? `${weaponName} hit for ${attack.damage}`
      : `Hit for ${attack.damage}`,
  };
}

export type PlayerCellOptions = {
  actions: BCFAction[];
  diedThisTick: boolean;
  blunder: boolean;
  externalStates: CustomState[];
  letterMode: boolean;
  showInventoryTags: boolean;
};

/**
 * Draws the content of a player cell.
 *
 * @param ctx Canvas context to draw to.
 * @param pos Top-left position of the cell.
 * @param cellSize Size of the cell.
 * @param imageCache Image cache to use.
 * @param options Options for the player cell.
 * @returns `true` if any image is pending.
 */
export function drawPlayerCell(
  ctx: CanvasRenderingContext2D,
  pos: Point,
  cellSize: number,
  imageCache: ImageCache,
  options: PlayerCellOptions,
): boolean {
  const { actions, diedThisTick, externalStates, letterMode } = options;

  let pending = false;

  const attack = actions.find((a) => a.type === 'attack');
  const spell = actions.find((a) => a.type === 'spell');

  const attackType =
    attack !== undefined
      ? (bcfToPlayerAttack(attack.attackType) ?? PlayerAttack.UNKNOWN)
      : undefined;

  let hasBaseImage = false;
  const customStates: CustomState[] = [];

  if (attack !== undefined && attackType !== undefined) {
    if (letterMode) {
      drawLetterMode(ctx, pos, cellSize, attackType);
      hasBaseImage = true;
    } else {
      hasBaseImage = drawWeapon(
        ctx,
        pos,
        cellSize,
        imageCache,
        attack,
        attackType,
        options.blunder,
        options.showInventoryTags,
      );
      pending ||= !hasBaseImage;

      if (spell !== undefined) {
        pending ||= !drawSpellOverlay(ctx, pos, cellSize, imageCache, spell);
      }
      pending ||= !drawAttackOverlay(
        ctx,
        pos,
        cellSize,
        imageCache,
        attack,
        attackType,
      );

      const dmg = createDamageCustomState(attack);
      if (dmg !== undefined) {
        customStates.push(dmg);
      }
    }
  } else if (spell !== undefined) {
    pending ||= !drawSpellBase(ctx, pos, cellSize, imageCache, spell);
    hasBaseImage = true;
  }

  if (diedThisTick) {
    const s = cellSize - 2;
    if (!hasBaseImage) {
      pending ||= !drawCachedImage(
        ctx,
        imageCache,
        '/images/combat/skull.webp',
        {
          x: pos.x + 1,
          y: pos.y + 1,
          width: s,
          height: s,
        },
      );
    } else {
      customStates.unshift({ iconUrl: '/images/combat/skull.webp' });
    }
  }

  customStates.push(...externalStates);
  if (customStates.length > 0) {
    pending ||= !drawCustomStates(ctx, pos, cellSize, customStates, imageCache);
  }

  return pending;
}

export type NpcCellOptions = {
  cell: BCFCell | undefined;
  npcLabel: string | undefined;
  externalStates: CustomState[];
};

/**
 * Draws the content of an NPC cell.
 *
 * @param ctx The canvas context to draw to.
 * @param pos Top-left position of the cell.
 * @param cellSize Size of the cell.
 * @param imageCache Image cache to use.
 * @param options Options for the NPC cell.
 * @returns `true` if any image is pending.
 */
export function drawNpcCell(
  ctx: CanvasRenderingContext2D,
  pos: Point,
  cellSize: number,
  imageCache: ImageCache,
  options: NpcCellOptions,
): boolean {
  const { cell, npcLabel, externalStates } = options;
  let pending = false;

  const attack = cell?.actions?.find(
    (a): a is BCFNpcAttackAction => a.type === 'npcAttack',
  );

  if (attack !== undefined) {
    const npcAttack = bcfToNpcAttack(attack.attackType);
    const meta = NPC_ATTACK_METADATA[npcAttack];
    if (meta !== undefined) {
      pending = !drawCachedImage(ctx, imageCache, meta.imageUrl, {
        x: pos.x,
        y: pos.y,
        width: cellSize,
        height: cellSize,
      });
    }
  }

  if (npcLabel !== undefined) {
    const fontSize = Math.min(Math.floor(cellSize / 2) - 2, 10);
    drawLabel(
      ctx,
      npcLabel,
      { x: pos.x + cellSize - 2, y: pos.y + cellSize },
      fontSize,
    );
  }

  if (externalStates.length > 0) {
    pending ||= !drawCustomStates(
      ctx,
      pos,
      cellSize,
      externalStates,
      imageCache,
    );
  }

  return pending;
}

/**
 * Draws custom state indicators in the top-right corner of a cell.
 * Shows only the first state's icon or label. If multiple states exist, a
 * `+` marker indicates more.
 *
 * @returns `true` if all images were drawn successfully.
 */
function drawCustomStates(
  ctx: CanvasRenderingContext2D,
  cellPos: Point,
  cellSize: number,
  states: CustomState[],
  imageCache: ImageCache,
): boolean {
  let allDrawn = true;

  const first = states[0];
  const iconSize = Math.floor(cellSize / 2);

  if (first.iconUrl !== undefined) {
    allDrawn = drawCachedImage(ctx, imageCache, first.iconUrl, {
      x: cellPos.x + cellSize - iconSize,
      y: cellPos.y,
      width: iconSize,
      height: iconSize,
    });
  } else if (first.label !== undefined) {
    ctx.font = `bold 8px 'Plus Jakarta Sans', sans-serif`;
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(first.label, cellPos.x + cellSize, cellPos.y);
  }

  if (states.length > 1) {
    ctx.font = `bold 8px 'Plus Jakarta Sans', sans-serif`;
    ctx.fillStyle = BLERT_PURPLE;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('+', cellPos.x + cellSize, cellPos.y + iconSize);
  }

  return allDrawn;
}
