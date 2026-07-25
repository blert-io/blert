import { getNameChangesForPlayer } from '@/actions/change-name';
import Card, { CardLink } from '@/components/card';
import SessionHistory from '@/components/session-history';

import { PlayerLayoutParams } from '../layout';
import { buildNameLineage } from './lineage';
import NameHistory from './name-history';

import styles from '../style.module.scss';

export default async function PlayerHistory({
  params,
}: {
  params: PlayerLayoutParams;
}) {
  const username = await params.then((u) => decodeURIComponent(u.username));
  const changes = await getNameChangesForPlayer(username, null);
  const lineage = buildNameLineage(changes);

  return (
    <div className={styles.history}>
      <div className={styles.historyGrid}>
        <Card
          className={styles.historyCard}
          header={{
            title: 'Recent Sessions',
            action: (
              <CardLink
                href={`/search?party=${encodeURIComponent(username)}`}
                text="View All"
              />
            ),
          }}
        >
          <SessionHistory count={10} username={username} />
        </Card>
        {lineage.length > 0 && (
          <NameHistory
            nodes={lineage}
            changeCount={changes.length}
            username={username}
          />
        )}
      </div>
    </div>
  );
}
