'use client';

import { useRouter } from 'next/navigation';
import React from 'react';

import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';

import styles from './style.module.scss';

export interface BadgeProps {
  iconClass: string;
  label: string;
  value: string | number;
  href?: string;
  tooltipContent?: string;
}

export default function Badge({
  iconClass,
  label,
  value,
  href,
  tooltipContent,
}: BadgeProps) {
  const router = useRouter();

  const dataAttributes: Record<string, string> = {};
  if (tooltipContent) {
    dataAttributes['data-tooltip-id'] = GLOBAL_TOOLTIP_ID;
    dataAttributes['data-tooltip-content'] = tooltipContent;
  }

  const content = (
    <>
      <i className={iconClass} />
      <strong>{label}:</strong>
      {value}
    </>
  );

  if (href) {
    return (
      <div
        {...dataAttributes}
        className={`${styles.badge} ${styles.link}`}
        role="link"
        tabIndex={0}
        onClick={() => router.push(href)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            router.push(href);
          }
        }}
        aria-label={`${label}: ${value}`}
      >
        {content}
      </div>
    );
  }

  return (
    <div className={styles.badge} {...dataAttributes}>
      {content}
    </div>
  );
}
