import { fitItemSprite, getItemImageUrl } from '@/utils/item';

import styles from './style.module.scss';

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
  /**
   * Fits the item, rather than its whole sprite, within `size`. The edges of
   * the sprite overflow the box.
   */
  fitContent?: boolean;
  /** Disables image smoothing. Use only when the sprite is drawn at 1:1. */
  pixelated?: boolean;
  className?: string;
  style?: React.CSSProperties;
  [key: `data-${string}`]: string | undefined;
};

// Lots of items are rendered on boss pages and Next's Image adds a lot of
// unnecessary rendering overhead.
/* eslint-disable @next/next/no-img-element */

export default function Item({
  id,
  name,
  quantity,
  outlineColor,
  size,
  fitContent,
  pixelated,
  className,
  style,
  ...dataAttributes
}: ItemProps) {
  const imageUrl = getItemImageUrl(id, quantity);

  const { text: quantityText, color: quantityColor } = formatQuantity(quantity);

  const imageStyle: React.CSSProperties = { objectFit: 'contain' };
  if (outlineColor) {
    imageStyle.filter =
      `drop-shadow(1px 2px 0 ${outlineColor})` +
      ` drop-shadow(-1px -1px 0 ${outlineColor})`;
  }
  if (pixelated) {
    imageStyle.imageRendering = 'pixelated';
  }

  let imageWidth = size;
  let imageHeight = size;
  if (fitContent) {
    const sprite = fitItemSprite(size, size);
    imageWidth = sprite.width;
    imageHeight = sprite.height;
    imageStyle.margin = `${(size - imageHeight) / 2}px ${(size - imageWidth) / 2}px`;
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
      <img
        src={imageUrl}
        alt={name}
        crossOrigin="anonymous"
        height={imageHeight}
        width={imageWidth}
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
