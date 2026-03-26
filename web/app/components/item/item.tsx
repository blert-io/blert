import Image from 'next/image';

import { getItemImageUrl } from '@/utils/item';

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
  const imageUrl = getItemImageUrl(id, name, quantity);

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
