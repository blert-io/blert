import React from 'react';

import { default as BaseTooltip } from '@/components/tooltip';

import { TableOfContents } from './table-of-contents';

import styles from './style.module.scss';

type PageProps = {
  children?: React.ReactNode;
  className?: string;
};

const ARTICLE_TOOLTIP_ID = 'article-tooltip';

export function Page({ children, className }: PageProps) {
  const classes = [styles.article, className].filter(Boolean).join(' ');
  return (
    <div className={styles.wrapper} id="blert-article-wrapper">
      <TableOfContents />
      <div className={classes}>{children}</div>
    </div>
  );
}

type TooltipProps = {
  children: React.ReactNode;
  text: string;
};

export function Tooltip({ children, text }: TooltipProps) {
  return (
    <span className={styles.tooltip} data-tooltip-id={ARTICLE_TOOLTIP_ID}>
      {children}
      <i className="fas fa-info" />
      <BaseTooltip maxWidth={400} tooltipId={ARTICLE_TOOLTIP_ID}>
        {text}
      </BaseTooltip>
    </span>
  );
}

type NoticeProps = {
  children: React.ReactNode;
  type?: 'warning' | 'info' | 'success' | 'error';
  icon?: string;
};

export function Notice({ children, type = 'info', icon }: NoticeProps) {
  const defaultIcons = {
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info',
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
  };

  return (
    <div className={`${styles.notice} ${styles[`notice-${type}`]}`}>
      <i className={`fas ${icon || defaultIcons[type]}`} />
      <div className={styles.noticeContent}>{children}</div>
    </div>
  );
}
