'use client';

import { DisplayContext } from '@/display';
import { useContext, useRef } from 'react';

import styles from './style.module.scss';

const YOUTUBE_ORIGIN = 'https://www.youtube-nocookie.com';

export type VideoChapter = {
  /** Offset into the video, in seconds. */
  time: number;
  label: string;
};

type YoutubeEmbedProps = {
  id: string;
  width?: number;
  compactWidth?: number;
  aspectRatio?: number;
  source?: 'youtube' | 'streamable';
  /** Seekable chapter list rendered below the player. Youtube only. */
  chapters?: VideoChapter[];
};

function timestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

export default function YoutubeEmbed({
  id,
  width = 840,
  compactWidth = 320,
  aspectRatio = 16 / 9,
  source = 'youtube',
  chapters,
}: YoutubeEmbedProps) {
  const display = useContext(DisplayContext);
  const frame = useRef<HTMLIFrameElement>(null);

  const adjustedWidth = display.isCompact() ? compactWidth : width;
  const adjustedHeight = Math.round(adjustedWidth / aspectRatio);

  const isYoutube = source === 'youtube';
  const src = isYoutube
    ? `${YOUTUBE_ORIGIN}/embed/${id}?enablejsapi=1`
    : `https://streamable.com/e/${id}`;

  const showChapters = isYoutube && chapters !== undefined;

  const seek = (seconds: number) => {
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({
        event: 'command',
        func: 'seekTo',
        args: [seconds, true],
      }),
      YOUTUBE_ORIGIN,
    );
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
      YOUTUBE_ORIGIN,
    );
  };

  return (
    <div className={styles.embed} style={{ width: adjustedWidth }}>
      <iframe
        ref={frame}
        width={adjustedWidth}
        height={adjustedHeight}
        src={src}
        title="Video player"
        frameBorder={0}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
      {showChapters && (
        <div className={styles.chapters}>
          {chapters.map((chapter) => (
            <button
              className={styles.chapter}
              key={chapter.time}
              onClick={() => seek(chapter.time)}
            >
              <span className={styles.time}>{timestamp(chapter.time)}</span>
              <span className={styles.label}>{chapter.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
