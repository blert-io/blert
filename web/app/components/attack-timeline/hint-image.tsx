'use client';

import Image from 'next/image';

import { fitItemSprite, isItemSpriteUrl } from '@/utils/item';

export function isValidImageUrl(url: string): boolean {
  if (url.startsWith('/')) {
    return !url.startsWith('//');
  }

  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

export type HintImageProps = {
  src: string;
  alt: string;
  size?: number;
  className?: string;
  fill?: boolean;
  style?: React.CSSProperties;
  outlineColor?: string;
};

export function HintImage({
  src,
  alt,
  size,
  className,
  fill,
  style,
  outlineColor,
}: HintImageProps) {
  if (!isValidImageUrl(src)) {
    return null;
  }

  const imageStyle: React.CSSProperties = { ...style, objectFit: 'contain' };
  if (outlineColor) {
    imageStyle.filter =
      `drop-shadow(1px 2px 0 ${outlineColor})` +
      ` drop-shadow(-1px -1px 0 ${outlineColor})`;
  }

  if (src.startsWith('/')) {
    return fill ? (
      <Image
        className={className}
        src={src}
        alt={alt}
        fill
        style={imageStyle}
      />
    ) : (
      <Image
        className={className}
        src={src}
        alt={alt}
        height={size}
        width={size}
        style={imageStyle}
      />
    );
  }

  const isItemSprite = isItemSpriteUrl(src);

  let baseStyle: React.CSSProperties;
  if (fill) {
    baseStyle = { objectFit: 'contain', width: '100%', height: '100%' };
  } else if (isItemSprite && size !== undefined) {
    const sprite = fitItemSprite(size, size);
    baseStyle = {
      ...sprite,
      margin: `${(size - sprite.height) / 2}px ${(size - sprite.width) / 2}px`,
    };
  } else {
    baseStyle = { objectFit: 'contain', width: size, height: size };
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      crossOrigin={isItemSprite ? 'anonymous' : undefined}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      style={{ ...baseStyle, ...imageStyle }}
    />
  );
}
