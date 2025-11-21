import React from 'react';

import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';

import { AppendixProvider, List as AppendixList } from './appendix';
import { TableOfContents } from './table-of-contents';

import styles from './style.module.scss';

type PageProps = {
  children?: React.ReactNode;
  className?: string;
};

export function Page({ children, className }: PageProps) {
  const classes = [styles.article, className].filter(Boolean).join(' ');
  return (
    <div className={styles.wrapper} id="blert-article-wrapper">
      <TableOfContents />
      <div className={classes}>
        <AppendixProvider>
          {children}
          <AppendixList />
        </AppendixProvider>
      </div>
    </div>
  );
}

type TooltipProps = {
  children: React.ReactNode;
  text: string;
};

export function Tooltip({ children, text }: TooltipProps) {
  return (
    <span
      className={styles.tooltip}
      data-tooltip-id={GLOBAL_TOOLTIP_ID}
      data-tooltip-content={text}
    >
      {children}
      <i className="fas fa-info" />
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
      <i className={`fas ${icon ?? defaultIcons[type]}`} />
      <div className={styles.noticeContent}>
        {(() => {
          const childArray = React.Children.toArray(children);
          const isPlainText = childArray.every(
            (child) => typeof child === 'string' || typeof child === 'number',
          );
          return isPlainText ? <p>{children}</p> : children;
        })()}
      </div>
    </div>
  );
}
