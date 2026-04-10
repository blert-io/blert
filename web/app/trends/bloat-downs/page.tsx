import { ResolvingMetadata } from 'next';

import Card from '@/components/card';
import { basicMetadata } from '@/utils/metadata';

import BloatDowns from './bloat-downs';

import styles from './style.module.scss';

export default function BloatDownsPage() {
  return (
    <div className={styles.bloatDowns}>
      <Card primary className={styles.header}>
        <h1>Bloat Down Analysis</h1>
        <p className={styles.subtitle}>
          Walk time distributions for Bloat downs across Theatre of Blood raids.
        </p>
      </Card>
      <Card className={styles.mainPanel}>
        <BloatDowns />
      </Card>
    </div>
  );
}

export async function generateMetadata(
  _props: unknown,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'OSRS Bloat Down Analysis',
    description:
      'Visualize Bloat walk time distributions across Theatre of Blood raids ' +
      'recorded on Blert, Old School RuneScape’s premier PvM tracker.',
  });
}
