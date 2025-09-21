'use client';

import { DisplayContext } from '@/display';
import { useContext } from 'react';

type YoutubeEmbedProps = {
  id: string;
  width?: number;
  compactWidth?: number;
  aspectRatio?: number;
  source?: 'youtube' | 'streamable';
};

export default function YoutubeEmbed({
  id,
  width = 840,
  compactWidth = 320,
  aspectRatio = 16 / 9,
  source = 'youtube',
}: YoutubeEmbedProps) {
  const display = useContext(DisplayContext);

  const adjustedWidth = display.isCompact() ? compactWidth : width;
  const adjustedHeight = Math.round(adjustedWidth / aspectRatio);

  const src =
    source === 'youtube'
      ? `https://www.youtube-nocookie.com/embed/${id}`
      : `https://streamable.com/e/${id}`;

  return (
    <iframe
      width={adjustedWidth}
      height={adjustedHeight}
      src={src}
      title="Video player"
      frameBorder={0}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      style={{ margin: '0 auto' }}
    />
  );
}
