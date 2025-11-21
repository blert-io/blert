import { ResolvingMetadata } from 'next';

import Card from '@/components/card';
import { basicMetadata } from '@/utils/metadata';

import BloatHands from './bloat-hands';

import styles from './style.module.scss';

export default function BloatHandsPage() {
  return (
    <div className={styles.bloatHands}>
      <Card primary className={styles.header}>
        <h1>Bloat Hand Spawn Analysis</h1>
        <p className={styles.subtitle}>
          Heatmaps of Bloat hand spawn rates across Theatre of Blood raids.
        </p>
      </Card>
      <Card className={styles.mainPanel}>
        <BloatHands />
      </Card>
    </div>
  );
}

export async function generateMetadata(
  _props: unknown,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'OSRS Bloat Hand Spawn Analysis',
    description:
      'Visualize trends in Bloat hand spawn patterns across Theatre of Blood raids ' +
      'recorded on Blert, Old School RuneScape’s premier PvM tracker.',
  });
}
