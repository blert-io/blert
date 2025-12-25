'use client';

import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ComponentPropsWithoutRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

import 'katex/dist/katex.min.css';
import styles from './style.module.scss';

type MarkdownRendererProps = {
  content: string;
  className?: string;
};

const ALLOWED_IMAGE_HOSTS = [
  'i.imgur.com',
  'imgur.com',
  'cdn.discordapp.com',
  'media.discordapp.net',
  'discordapp.net',
  'i.redd.it',
  'preview.redd.it',
  'giphy.com',
  'media0.giphy.com',
];

type VideoEmbed = {
  source: 'youtube' | 'streamable';
  id: string;
};

/**
 * Parses a URL to extract video embed information if it's a supported video URL.
 */
function parseVideoUrl(url: string): VideoEmbed | null {
  try {
    const parsed = new URL(url);

    // YouTube: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID
    if (
      parsed.hostname === 'www.youtube.com' ||
      parsed.hostname === 'youtube.com'
    ) {
      const videoId = parsed.searchParams.get('v');
      if (videoId) {
        return { source: 'youtube', id: videoId };
      }
      const embedMatch = /^\/embed\/([a-zA-Z0-9_-]+)/.exec(parsed.pathname);
      if (embedMatch) {
        return { source: 'youtube', id: embedMatch[1] };
      }
    }

    if (parsed.hostname === 'youtu.be') {
      const videoId = parsed.pathname.slice(1);
      if (videoId) {
        return { source: 'youtube', id: videoId };
      }
    }

    // Streamable: streamable.com/ID
    if (parsed.hostname === 'streamable.com') {
      // Skip /e/ embed URLs to avoid recursion.
      if (parsed.pathname.startsWith('/e/')) {
        return null;
      }
      const videoId = parsed.pathname.slice(1);
      if (videoId && !videoId.includes('/')) {
        return { source: 'streamable', id: videoId };
      }
    }

    return null;
  } catch {
    return null;
  }
}

function VideoEmbedComponent({ video }: { video: VideoEmbed }) {
  const src =
    video.source === 'youtube'
      ? `https://www.youtube-nocookie.com/embed/${video.id}`
      : `https://streamable.com/e/${video.id}`;

  return (
    <div className={styles.videoWrapper}>
      <iframe
        src={src}
        title={`${video.source === 'youtube' ? 'YouTube' : 'Streamable'} video`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}

/**
 * Validates if an image URL is from an allowed host and uses HTTPS.
 */
function isImageUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== 'https:') {
      return false;
    }

    return ALLOWED_IMAGE_HOSTS.some(
      (host) =>
        parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

function ImageViewer({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const [portalElement, setPortalElement] = useState<HTMLDivElement | null>(
    null,
  );

  useEffect(() => {
    const root = document.getElementById('portal-root');
    if (!root) {
      return;
    }

    const portal = document.createElement('div');
    portal.classList.add(styles.imagePortal);
    root.appendChild(portal);
    setPortalElement(portal);

    return () => {
      root.removeChild(portal);
      setPortalElement(null);
    };
  }, []);

  useEffect(() => {
    if (!portalElement) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).classList.contains(styles.imageOverlay)) {
        onClose();
      }
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleClick);

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClick);
    };
  }, [onClose, portalElement]);

  if (!portalElement) {
    return null;
  }

  return createPortal(
    <div className={styles.imageOverlay}>
      <button
        className={styles.imageCloseButton}
        onClick={onClose}
        aria-label="Close image viewer"
      >
        <i className="fas fa-times" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className={styles.imageFullsize} />
    </div>,
    portalElement,
  );
}

export default function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  const [viewedImage, setViewedImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  const combinedClassName = className
    ? `${styles.markdown} ${className}`
    : styles.markdown;

  return (
    <>
      {viewedImage && (
        <ImageViewer
          src={viewedImage.src}
          alt={viewedImage.alt}
          onClose={() => setViewedImage(null)}
        />
      )}
      <div className={combinedClassName}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            a: ({ href, children, ...props }) => {
              if (!href) {
                return <a {...props}>{children}</a>;
              }

              const video = parseVideoUrl(href);
              if (video) {
                return <VideoEmbedComponent video={video} />;
              }

              const isExternal =
                href.startsWith('http://') || href.startsWith('https://');

              if (isExternal) {
                return (
                  <a
                    href={href}
                    {...props}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.externalLink}
                  >
                    {children}
                    <i className="fas fa-external-link-alt" />
                  </a>
                );
              }

              return (
                <Link href={href} {...props}>
                  {children}
                </Link>
              );
            },
            img: ({ src, alt }) => {
              if (!src || typeof src !== 'string' || !isImageUrlAllowed(src)) {
                return (
                  <span
                    className={styles.invalidImage}
                    title="Image from untrusted source"
                  >
                    [Invalid or untrusted image: {alt ?? 'no description'}]
                  </span>
                );
              }

              return (
                <span
                  className={styles.imageWrapper}
                  onClick={() =>
                    setViewedImage({ src, alt: alt ?? 'Setup image' })
                  }
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setViewedImage({ src, alt: alt ?? 'Setup image' });
                    }
                  }}
                  aria-label={`View full size: ${alt ?? 'Setup image'}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={alt ?? 'Setup image'}
                    loading="lazy"
                    className={styles.image}
                  />
                </span>
              );
            },
            code: ({
              inline,
              className,
              children,
              ...props
            }: ComponentPropsWithoutRef<'code'> & { inline?: boolean }) => {
              if (inline) {
                return (
                  <code className={styles.inlineCode} {...props}>
                    {children}
                  </code>
                );
              }
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            },
            table: ({ children, ...props }) => (
              <div className={styles.tableWrapper}>
                <table {...props}>{children}</table>
              </div>
            ),
            input: ({ type, ...props }) => {
              if (type === 'checkbox') {
                return <input type="checkbox" disabled {...props} />;
              }
              return <input type={type} {...props} />;
            },
            h1: ({ children, node: _node, ...props }) => (
              <h3 {...props}>{children}</h3>
            ),
            h2: ({ children, node: _node, ...props }) => (
              <h4 {...props}>{children}</h4>
            ),
            h3: ({ children, node: _node, ...props }) => (
              <h5 {...props}>{children}</h5>
            ),
            h4: ({ children, node: _node, ...props }) => (
              <h6 {...props}>{children}</h6>
            ),
            h5: ({ children, node: _node, ...props }) => (
              <h6 {...props}>{children}</h6>
            ),
            h6: ({ children, node: _node, ...props }) => (
              <h6 {...props}>{children}</h6>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </>
  );
}
