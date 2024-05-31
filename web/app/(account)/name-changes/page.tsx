import Link from 'next/link';

import { getRecentNameChanges } from '@/actions/change-name';
import NameChangeRow from './name-change-row';

import styles from './style.module.scss';

export default async function NameChanges() {
  const nameChanges = await getRecentNameChanges();

  return (
    <div className={styles.nameChanges}>
      <div className={styles.heading}>
        <h2>Recent Name Changes</h2>
        <Link className={styles.submit} href="/change-name">
          Submit a name change
        </Link>
      </div>
      {nameChanges.length > 0 ? (
        <div className={styles.table}>
          {nameChanges.map((nameChange, i) => (
            <NameChangeRow key={i} id={i} nameChange={nameChange} />
          ))}
        </div>
      ) : (
        <div className={styles.empty}>No recent name changes</div>
      )}
    </div>
  );
}

export const dynamic = 'force-dynamic';
