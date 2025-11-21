'use client';

import Link from 'next/link';
import React, { useCallback } from 'react';

import { useToast } from '@/components/toast';

import styles from './style.module.scss';

type HeadingProps = React.HTMLAttributes<HTMLHeadingElement> & {
  className?: string;
  id?: string;
  idPrefix?: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
};

export function Heading({
  className,
  level,
  text,
  id: userId,
  idPrefix,
  ...headingProps
}: HeadingProps) {
  const showToast = useToast();

  let id: string;

  if (userId) {
    id = userId;
  } else {
    id = text
      .toLowerCase()
      .replace(/ /g, '-')
      .replace(/[^a-z0-9-]/g, '');
    if (idPrefix) {
      id = `${idPrefix}-${id}`;
    }
  }

  const handleCopyLink = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();

      try {
        const url = `${window.location.origin}${window.location.pathname}#${id}`;
        await navigator.clipboard.writeText(url);
        showToast('Link copied to clipboard!');
      } catch {
        showToast('Failed to copy link', 'error');
      }
    },
    [id, showToast],
  );

  let fullClass = styles.heading;
  if (className) {
    fullClass += ` ${className}`;
  }

  const Tag = `h${level}` as any;

  return (
    <Tag {...headingProps} className={fullClass} id={id}>
      <button
        className={styles.linkButton}
        onClick={(e) => void handleCopyLink(e)}
        title={`Copy link to "${text}"`}
        aria-label={`Copy link to ${text}`}
      >
        <i className="fas fa-link" />
      </button>
      <Link href={`#${id}`}>{text}</Link>
    </Tag>
  );
}
