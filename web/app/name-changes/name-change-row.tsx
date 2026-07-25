'use client';

import { Fragment, ReactNode } from 'react';

import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';

import { FeedRow } from './format';

import styles from './style.module.scss';

type NameChangeItemProps = {
  row: FeedRow;
  /** Substring to highlight in each name. */
  highlight?: string;
};

/** Highlights every case-insensitive occurrence of `query` within `text`. */
function highlightMatches(text: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return text;
  }

  const haystack = text.toLowerCase();
  const parts: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < text.length) {
    const match = haystack.indexOf(needle, index);
    if (match === -1) {
      parts.push(<Fragment key={key++}>{text.slice(index)}</Fragment>);
      break;
    }
    if (match > index) {
      parts.push(<Fragment key={key++}>{text.slice(index, match)}</Fragment>);
    }
    parts.push(
      <mark key={key++} className={styles.mark}>
        {text.slice(match, match + needle.length)}
      </mark>,
    );
    index = match + needle.length;
  }

  return parts;
}

function StatusIndicator({ row }: { row: FeedRow }) {
  if (row.outcome === 'accepted') {
    return (
      <i
        className={`fas fa-check ${styles.accepted}`}
        title="Accepted"
        aria-label="Accepted"
      />
    );
  }
  if (row.outcome === 'pending') {
    return (
      <span className={styles.pending}>
        <span className={styles.pendingDot} />
        Pending
      </span>
    );
  }
  return (
    <span className={styles.rejected}>
      <i className="fas fa-circle-xmark" />
      Rejected
    </span>
  );
}

export default function NameChangeItem({
  row,
  highlight,
}: NameChangeItemProps) {
  const rejected = row.outcome === 'rejected';

  return (
    <div className={`${styles.row} ${rejected ? styles.rowRejected : ''}`}>
      <div className={styles.rowMain}>
        <div className={styles.names}>
          <span className={styles.oldName}>
            {highlight ? highlightMatches(row.oldName, highlight) : row.oldName}
          </span>
          <i className="fas fa-arrow-right" />
          <span
            className={`${styles.newName} ${rejected ? styles.struck : ''}`}
          >
            {highlight ? highlightMatches(row.newName, highlight) : row.newName}
          </span>
        </div>
        <StatusIndicator row={row} />
        <span
          className={styles.time}
          data-tooltip-id={GLOBAL_TOOLTIP_ID}
          data-tooltip-content={row.timeTooltip}
        >
          {row.timeLabel}
        </span>
      </div>
      {row.rejectionReason !== null && (
        <div className={styles.reason}>{row.rejectionReason}</div>
      )}
    </div>
  );
}
