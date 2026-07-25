import { ResolvingMetadata } from 'next';

import { getNameChanges } from '@/actions/change-name';
import { basicMetadata } from '@/utils/metadata';

import { PAGE_SIZE, toFeedRow } from './format';
import NameChangeFeed from './name-change-feed';

import styles from './style.module.scss';

export default async function NameChanges() {
  const now = Date.now();
  const page = await getNameChanges(null, PAGE_SIZE, '');
  const initialRows = page.changes.map((change) => toFeedRow(change, now));

  return (
    <div className={styles.page}>
      <NameChangeFeed
        initialRows={initialRows}
        initialCursor={page.nextCursor}
        trackedTotal={page.total}
        serverNow={now}
      />
    </div>
  );
}

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  _props: Record<string, never>,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'Name Changes',
    description: 'Track recent OSRS player name changes.',
  });
}
