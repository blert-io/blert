import Image from 'next/image';

import styles from './style.module.scss';

type ItemProps = {
  name: string;
  quantity: number;
  outlineColor?: string;
};

const WIKI_IMAGE_BASE_URL: string = 'https://oldschool.runescape.wiki/images';

const ONE_TO_FIVE_REGEX =
  /(arrow(\(p\+*\)|tips|heads)?|bolts( ?\((unf|e|p\+*)\))?)$/;

function is1to5Item(name: string): boolean {
  return name.match(ONE_TO_FIVE_REGEX) !== null;
}

function normalize(name: string, quantity: number): string {
  const stem = name.replaceAll(' ', '_');

  if (is1to5Item(name)) {
    const qty = Math.min(quantity, 5);
    return `${stem}_${qty}`;
  }

  return stem;
}

export default function Item(props: ItemProps) {
  const imageUrl = `${WIKI_IMAGE_BASE_URL}/${normalize(
    props.name,
    props.quantity,
  )}.png`;

  const quantityColor = 'yellow';

  let imageStyle: React.CSSProperties = { objectFit: 'contain' };
  if (props.outlineColor) {
    imageStyle.filter =
      `drop-shadow(1px 2px 0 ${props.outlineColor})` +
      ` drop-shadow(-1px -1px 0 ${props.outlineColor})`;
  }

  return (
    <div className={styles.image}>
      <Image src={imageUrl} alt={props.name} fill style={imageStyle} />
      {props.quantity > 1 && (
        <div className={styles.quantity} style={{ color: quantityColor }}>
          {props.quantity}
        </div>
      )}
    </div>
  );
}
