import ChallengeHistory from '@/components/challenge-history';
import { getNameChangesForPlayer } from '@/actions/change-name';
import type { NameChange } from '@blert/common';

import Card, { CardLink } from '@/components/card';
import { PlayerLayoutParams } from '../layout';

import styles from '../style.module.scss';

type DisplayNameChange = {
  oldName: string;
  newName: string;
  processedAt: Date;
};

function NameChangeHistory({
  nameChanges,
  currentUsername,
}: {
  nameChanges: DisplayNameChange[];
  currentUsername: string;
}) {
  return (
    <Card
      className={styles.nameChanges}
      header={{
        title: (
          <>
            <i className="fas fa-id-card" /> Name Changes
          </>
        ),
      }}
    >
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
      <CardLink
        href={`/change-name?rsn=${encodeURIComponent(currentUsername)}`}
        text="Submit a Name Change"
      />
    </Card>
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
      <div
        className={`${styles.historyGrid} ${nameChanges.length === 0 ? styles.fullWidth : ''}`}
      >
        <Card
          className={styles.historyCard}
          header={{
            title: 'Recent Challenges',
            action: (
              <CardLink
                href={`/search?party=${encodeURIComponent(username)}`}
                text="View All"
              />
            ),
          }}
        >
          <ChallengeHistory count={20} username={username} />
        </Card>
        {nameChanges.length > 0 && (
          <NameChangeHistory
            nameChanges={nameChanges}
            currentUsername={username}
          />
        )}
      </div>
    </div>
  );
}
