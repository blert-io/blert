import Image from 'next/image';

import styles from './style.module.scss';

const WIKI_IMAGE_BASE_URL: string = 'https://oldschool.runescape.wiki/images';
const CACHE_SPRITE_DUMP_URL: string =
  'https://chisel.weirdgloop.org/static/img/osrs-sprite';

// A common case is items which have different sprites for each quantity from
// 1 to 5. A lot of range ammo falls into this category. This regex attempts to
// match as many of these items as possible.
const ONE_TO_FIVE_REGEX =
  /(arrow(\(p\+*\)|tips|heads| \(lit\))?|bolts( ?\((unf|e|p\+*)\))?)$/;
const ONE_TO_FIVE_ITEMS = new Set(['Atlatl dart']);

function is1to5Item(name: string): boolean {
  return ONE_TO_FIVE_ITEMS.has(name) || ONE_TO_FIVE_REGEX.exec(name) !== null;
}

const BARROWS_REGEX = /^(Ahrim's|Dharok's|Guthan's|Karil's|Torag's|Verac's)/;

function isBarrowsItem(name: string): boolean {
  return BARROWS_REGEX.exec(name) !== null;
}

/**
 * Converts an in-game item name to the filename of its image on the wiki.
 * Handles special cases like items whose sprites change based on quantity.
 *
 * @param name The full name of the item, as appears in game.
 * @param quantity Quantity of the item.
 * @returns The file stem of the item's image, without the `.png` extension.
 */
function normalizeToWiki(name: string, quantity: number): string {
  // Treat locked items as their unlocked counterparts.
  name = name.replace(/\(l\)/, '');

  const words = name.trim().split(' ');
  if (isBarrowsItem(name)) {
    // Ignore the degradation state of Barrows items.
    if (!Number.isNaN(Number.parseInt(words[words.length - 1]))) {
      words.pop();
    }
  }

  // The basic format of wiki image filenames takes the item name as it appears
  // in game (preserving case), and replaces spaces with underscores.
  const stem = words.join('_');

  if (is1to5Item(name)) {
    // Items using a different sprite from 1-5 are suffixed with their quantity
    // on the wiki.
    const qty = Math.min(quantity, 5);
    return `${stem}_${qty}`;
  }

  return stem;
}

const QUANTITY_REG_COLOR = '#f9f900';
const QUANTITY_K_COLOR = '#fdfdfd';
const QUANTITY_M_COLOR = '#04e976';

function formatQuantity(quantity: number): { text: string; color: string } {
  if (quantity === 1) {
    return { text: '', color: QUANTITY_REG_COLOR };
  }
  if (quantity < 100_000) {
    return { text: quantity.toString(), color: QUANTITY_REG_COLOR };
  }
  if (quantity < 10_000_000) {
    const thousands = Math.floor(quantity / 1000);
    return { text: `${thousands}K`, color: QUANTITY_K_COLOR };
  }
  const millions = Math.floor(quantity / 1_000_000);
  return { text: `${millions}M`, color: QUANTITY_M_COLOR };
}

type ItemProps = {
  id: number;
  name: string;
  quantity: number;
  outlineColor?: string;
  size: number;
  className?: string;
  style?: React.CSSProperties;
  [key: `data-${string}`]: string | undefined;
};

export default function Item({
  id,
  name,
  quantity,
  outlineColor,
  size,
  className,
  style,
  ...dataAttributes
}: ItemProps) {
  let imageUrl: string;

  // For most items, fetch their cache sprite via their ID. However, items which
  // have different sprites for each quantity (e.g. range ammo) are handled
  // separately via a wiki image URL.
  if (is1to5Item(name)) {
    imageUrl = `${WIKI_IMAGE_BASE_URL}/${normalizeToWiki(name, quantity)}.png`;
  } else {
    imageUrl = `${CACHE_SPRITE_DUMP_URL}/${id}.png`;
  }

  const { text: quantityText, color: quantityColor } = formatQuantity(quantity);

  const imageStyle: React.CSSProperties = { objectFit: 'contain' };
  if (outlineColor) {
    imageStyle.filter =
      `drop-shadow(1px 2px 0 ${outlineColor})` +
      ` drop-shadow(-1px -1px 0 ${outlineColor})`;
  }

  const cssStyle = {
    ...style,
    width: size,
    height: size,
  };

  let cls = styles.image;
  if (className) {
    cls = `${cls} ${className}`;
  }

  return (
    <div className={cls} style={cssStyle} {...dataAttributes}>
      <Image
        src={imageUrl}
        alt={name}
        height={size}
        width={size}
        style={imageStyle}
      />
      {quantityText && (
        <div className={styles.quantity} style={{ color: quantityColor }}>
          {quantityText}
        </div>
      )}
    </div>
  );
}
