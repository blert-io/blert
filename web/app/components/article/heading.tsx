'use client';

import Link from 'next/link';
import React, { useCallback } from 'react';

import { useToast } from '@/components/toast';

import styles from './style.module.scss';

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join('');
  }
  if (
    React.isValidElement<{ children?: React.ReactNode }>(node) &&
    node.props.children !== undefined
  ) {
    return extractText(node.props.children);
  }
  return '';
}

type HeadingProps = React.HTMLAttributes<HTMLHeadingElement> & {
  className?: string;
  id?: string;
  idPrefix?: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text?: string;
  children?: React.ReactNode;
};

export function Heading({
  className,
  level,
  text,
  children,
  id: userId,
  idPrefix,
  ...headingProps
}: HeadingProps) {
  const showToast = useToast();

  const displayText = text ?? extractText(children);
  const displayContent = text ?? children;

  let id: string;

  if (userId) {
    id = userId;
  } else {
    id = displayText
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

  const Tag: React.ElementType = `h${level}`;

  return (
    <Tag {...headingProps} className={fullClass} id={id}>
      <button
        className={styles.linkButton}
        onClick={(e) => void handleCopyLink(e)}
        title={`Copy link to "${displayText}"`}
        aria-label={`Copy link to ${displayText}`}
      >
        <i className="fas fa-link" />
      </button>
      <Link href={`#${id}`}>{displayContent}</Link>
    </Tag>
  );
}
