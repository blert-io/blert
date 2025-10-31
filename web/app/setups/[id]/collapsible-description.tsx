'use client';

import { useState, useRef, useEffect } from 'react';

import MarkdownRenderer from '@/components/markdown-renderer';

import styles from './style.module.scss';

type CollapsibleDescriptionProps = {
  text: string;
};

const COLLAPSED_HEIGHT = 200;

export default function CollapsibleDescription({
  text,
}: CollapsibleDescriptionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [shouldShowToggle, setShouldShowToggle] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      setShouldShowToggle(contentRef.current.scrollHeight > COLLAPSED_HEIGHT);
    }
  }, [text]);

  const maxHeight = isExpanded
    ? Math.min(
        contentRef.current?.scrollHeight ?? 0,
        typeof window !== 'undefined' ? window.innerHeight * 0.8 : 1000,
      )
    : COLLAPSED_HEIGHT;

  return (
    <div className={styles.description}>
      <div
        ref={contentRef}
        className={
          shouldShowToggle && !isExpanded ? styles.collapsed : undefined
        }
        style={{ maxHeight }}
      >
        <MarkdownRenderer content={text} />
      </div>
      {shouldShowToggle && (
        <button
          className={`${styles.toggle} ${isExpanded ? styles.expanded : ''}`}
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          {isExpanded ? 'Show less' : 'Show more'}
          <i className="fas fa-chevron-down" />
        </button>
      )}
    </div>
  );
}
