import Image from 'next/image';

import styles from './style.module.scss';

type ItemProps = {
  name: string;
  quantity: number;
  outlineColor?: string;
  size: number;
  style?: React.CSSProperties;
};

const WIKI_IMAGE_BASE_URL: string = 'https://oldschool.runescape.wiki/images';

// A common case is items which have different sprites for each quantity from
// 1 to 5. A lot of range ammo falls into this category. This regex attempts to
// match as many of these items as possible.
const ONE_TO_FIVE_REGEX =
  /(arrow(\(p\+*\)|tips|heads| \(lit\))?|bolts( ?\((unf|e|p\+*)\))?)$/;
const ONE_TO_FIVE_ITEMS = new Set(['Atlatl dart']);

function is1to5Item(name: string): boolean {
  return ONE_TO_FIVE_ITEMS.has(name) || name.match(ONE_TO_FIVE_REGEX) !== null;
}

const BARROWS_REGEX = /^(Ahrim's|Dharok's|Guthan's|Karil's|Torag's|Verac's)/;

function isBarrowsItem(name: string): boolean {
  return name.match(BARROWS_REGEX) !== null;
}

/**
 * Converts an in-game item name to the filename of its image on the wiki.
 * Handles special cases like items whose sprites change based on quantity.
 *
 * @param name The full name of the item, as appears in game.
 * @param quantity Quantity of the item.
 * @returns The file stem of the item's image, without the `.png` extension.
 */
function normalize(name: string, quantity: number): string {
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

export default function Item(props: ItemProps) {
  const imageUrl = `${WIKI_IMAGE_BASE_URL}/${normalize(
    props.name,
    props.quantity,
  )}.png`;

  const { text: quantityText, color: quantityColor } = formatQuantity(props.quantity);

  let imageStyle: React.CSSProperties = { objectFit: 'contain' };
  if (props.outlineColor) {
    imageStyle.filter =
      `drop-shadow(1px 2px 0 ${props.outlineColor})` +
      ` drop-shadow(-1px -1px 0 ${props.outlineColor})`;
  }

  const style = {
    ...props.style,
    width: props.size,
    height: props.size,
  };

  return (
    <div className={styles.image} style={style}>
      <Image
        src={imageUrl}
        alt={props.name}
        height={props.size}
        width={props.size}
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
