'use client';

import { DisplayContext } from '@/display';
import { useContext } from 'react';

type YoutubeEmbedProps = {
  id: string;
  width?: number;
  compactWidth?: number;
  aspectRatio?: number;
};

export default function YoutubeEmbed({
  id,
  width = 560,
  compactWidth = 320,
  aspectRatio = 16 / 9,
}: YoutubeEmbedProps) {
  const display = useContext(DisplayContext);

  const adjustedWidth = display.isCompact() ? compactWidth : width;
  const adjustedHeight = Math.round(adjustedWidth / aspectRatio);

  return (
    <iframe
      width={adjustedWidth}
      height={adjustedHeight}
      src={`https://www.youtube-nocookie.com/embed/${id}`}
      title="YouTube video player"
      frameBorder={0}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
    />
  );
}
