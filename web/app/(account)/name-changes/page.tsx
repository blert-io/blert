import { ResolvingMetadata } from 'next';
import Link from 'next/link';

import { getRecentNameChanges } from '@/actions/change-name';
import Tooltip from '@/components/tooltip';
import { basicMetadata } from '@/utils/metadata';

import NameChangeRow from './name-change-row';

import styles from './style.module.scss';

export default async function NameChanges() {
  const nameChanges = await getRecentNameChanges();

  return (
    <div className={styles.nameChanges}>
      <div className={styles.nameChangesInner}>
        <div className={styles.header}>
          <h1>
            <i className="fas fa-history" /> Recent Name Changes
          </h1>
          <Link href="/change-name" className={styles.submitButton}>
            Submit a name change
          </Link>
        </div>

        <div className={styles.nameChangeList}>
          {nameChanges.map((change, i) => (
            <NameChangeRow key={i} nameChange={change} />
          ))}
        </div>
      </div>
      <Tooltip tooltipId="name-change-tooltip">
        <div />
      </Tooltip>
    </div>
  );
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: 'Recent Name Changes',
    description: 'Track recent OSRS player name changes.',
  });
}
