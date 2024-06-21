import React from 'react';

import { default as BaseTooltip } from '@/components/tooltip';

import styles from './style.module.scss';

type PageProps = {
  children?: React.ReactNode;
};

const ARTICLE_TOOLTIP_ID = 'article-tooltip';

export function Page({ children }: PageProps) {
  return (
    <div className={styles.wrapper} id="blert-article-wrapper">
      <div className={styles.article}>{children}</div>
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
