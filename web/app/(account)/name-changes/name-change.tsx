'use client';

import { NameChangeStatus } from '@blert/common';
import { useEffect, useState } from 'react';
import TimeAgo from 'react-timeago';

import { PlainNameChange } from '@/actions/change-name';
import LigmaTooltip from '@/components/ligma-tooltip';

import styles from './style.module.scss';

type NameChangeProps = {
  nameChange: PlainNameChange;
  id: number;
};

function nameChangeInfo(
  nameChange: PlainNameChange,
): [string, string, string | null] {
  switch (nameChange.status) {
    case NameChangeStatus.PENDING:
      return ['Pending', 'var(--blert-text-color)', null];
    case NameChangeStatus.ACCEPTED:
      return ['Accepted', 'var(--blert-green)', null];
    case NameChangeStatus.OLD_STILL_IN_USE:
      return [
        'Rejected',
        'var(--blert-red)',
        `This name change was rejected because the username ` +
          `"${nameChange.oldName}" is still in use.`,
      ];
    case NameChangeStatus.NEW_DOES_NOT_EXIST:
      return [
        'Rejected',
        'var(--blert-red)',
        `This name change was rejected because the username ` +
          `"${nameChange.newName}" is not on the Hiscores.`,
      ];
    case NameChangeStatus.DECREASED_EXPERIENCE:
      return [
        'Rejected',
        'var(--blert-red)',
        `This name change was rejected because the account ` +
          `"${nameChange.newName}" has less experience than ` +
          `"${nameChange.oldName}" previously had.`,
      ];
  }
}

export default function NameChange({ nameChange, id }: NameChangeProps) {
  const [loaded, setLoaded] = useState(false);
  const [statusString, statusColor, reason] = nameChangeInfo(nameChange);

  useEffect(() => setLoaded(true), []);

  const tooltipId = `name-change-${id}`;

  return (
    <div className={styles.nameChange}>
      <div className={`${styles.name} ${styles.old}`}>{nameChange.oldName}</div>
      <div className={styles.arrow}>
        <i className="fas fa-arrow-right" />
      </div>
      <div className={styles.name}>{nameChange.newName}</div>
      <div className={styles.submitted}>
        Submitted{' '}
        {loaded && <TimeAgo date={nameChange.submittedAt} live={false} />}
      </div>
      <div className={styles.processed}>
        {nameChange.processedAt && (
          <>
            {'Processed '}
            {loaded && <TimeAgo date={nameChange.processedAt} live={false} />}
          </>
        )}
      </div>
      <div className={styles.status} style={{ color: statusColor }}>
        {statusString}
        {reason !== null && (
          <>
            <LigmaTooltip tooltipId={tooltipId}>
              <span className={styles.tooltip}>{reason}</span>
            </LigmaTooltip>
            <i className={`fa fa-info-circle`} data-tooltip-id={tooltipId} />
            <span className="sr-only">{reason}</span>
          </>
        )}
      </div>
    </div>
  );
}
