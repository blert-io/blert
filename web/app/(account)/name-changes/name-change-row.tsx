'use client';

import { NameChange, NameChangeStatus } from '@blert/common';
import TimeAgo from 'react-timeago';

import { useClientOnly } from '@/hooks/client-only';

import styles from './style.module.scss';

type NameChangeRowProps = {
  nameChange: NameChange;
};

function nameChangeInfo(nameChange: NameChange): [string, string | null] {
  switch (nameChange.status) {
    case NameChangeStatus.PENDING:
    case NameChangeStatus.DEFERRED:
      return ['Pending', null];
    case NameChangeStatus.ACCEPTED:
      return ['Accepted', null];
    case NameChangeStatus.OLD_STILL_IN_USE:
      return [
        'Rejected',
        `This name change was rejected because the username "${nameChange.oldName}" is still in use.`,
      ];
    case NameChangeStatus.NEW_DOES_NOT_EXIST:
      return [
        'Rejected',
        `This name change was rejected because the username "${nameChange.newName}" is not on the Hiscores.`,
      ];
    case NameChangeStatus.DECREASED_EXPERIENCE:
      return [
        'Rejected',
        `This name change was rejected because the account "${nameChange.newName}" has less experience than "${nameChange.oldName}" previously had.`,
      ];
  }
}

export default function NameChangeRow({ nameChange }: NameChangeRowProps) {
  const { oldName, newName, submittedAt, processedAt, status } = nameChange;

  const isClient = useClientOnly();

  const [statusText, statusReason] = nameChangeInfo(nameChange);

  return (
    <div className={styles.nameChangeRow}>
      <div className={styles.names}>
        <span className={styles.oldName}>{oldName}</span>
        <i className="fas fa-arrow-right" />
        <span className={styles.newName}>{newName}</span>
      </div>

      <div className={styles.timestamps}>
        <div className={styles.timestamp}>
          <span className={styles.label}>Submitted</span>
          <span className={styles.value}>
            {isClient ? <TimeAgo date={submittedAt} /> : '-'}
          </span>
        </div>

        <div className={styles.timestamp}>
          <span className={styles.label}>Processed</span>
          <span className={styles.value}>
            {isClient ? (
              processedAt ? (
                <TimeAgo date={processedAt} />
              ) : (
                'Pending'
              )
            ) : (
              '-'
            )}
          </span>
        </div>
      </div>

      <div className={styles.status}>
        <span
          className={`${styles.statusBadge} ${
            status === NameChangeStatus.ACCEPTED
              ? styles.accepted
              : status === NameChangeStatus.PENDING ||
                  status === NameChangeStatus.DEFERRED
                ? styles.pending
                : styles.rejected
          }`}
        >
          {statusText}
          {statusReason && (
            <i
              className="fas fa-info-circle"
              data-tooltip-id="name-change-tooltip"
              data-tooltip-content={statusReason}
            />
          )}
        </span>
      </div>
    </div>
  );
}
