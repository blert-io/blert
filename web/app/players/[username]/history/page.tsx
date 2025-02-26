import ChallengeHistory from '@/components/challenge-history';
import { getNameChangesForPlayer } from '@/actions/change-name';
import type { NameChange } from '@blert/common';

import { PlayerLayoutParams } from '../layout';

import styles from '../style.module.scss';

type DisplayNameChange = {
  oldName: string;
  newName: string;
  processedAt: Date;
};

function NameChangeHistory({
  nameChanges,
}: {
  nameChanges: DisplayNameChange[];
}) {
  if (nameChanges.length === 0) {
    return null;
  }

  return (
    <div className={`${styles.section} ${styles.nameChanges}`}>
      <h2>
        <i className="far fa-id-card" /> Name Changes
      </h2>
      <div className={styles.nameChangeList}>
        {nameChanges.map((change) => (
          <div key={change.processedAt.getTime()} className={styles.nameChange}>
            <div className={styles.names}>
              <span className={styles.oldName}>{change.oldName}</span>
              <i className="fas fa-arrow-right" />
              <span className={styles.newName}>{change.newName}</span>
            </div>
            <div className={styles.date}>
              {change.processedAt.toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function PlayerHistory({
  params,
}: {
  params: PlayerLayoutParams;
}) {
  const username = await params.then((u) => decodeURIComponent(u.username));
  const rawNameChanges = await getNameChangesForPlayer(username);

  const nameChanges: DisplayNameChange[] = rawNameChanges
    .filter(
      (change): change is NameChange & { processedAt: Date } =>
        change.processedAt !== null,
    )
    .map((change) => ({
      oldName: change.oldName,
      newName: change.newName,
      processedAt: change.processedAt,
    }));

  return (
    <div className={styles.history}>
      <div className={styles.section}>
        <h2>Recent Challenges</h2>
        <ChallengeHistory count={25} username={username} />
      </div>
      <NameChangeHistory nameChanges={nameChanges} />
    </div>
  );
}
