import { Metadata } from 'next';

import Card from '@/components/card';

import BloatHands from './bloat-hands';

import styles from './style.module.scss';

export default function BloatHandsPage() {
  return (
    <div className={styles.bloatHands}>
      <div className={styles.header}>
        <h1>Bloat Hand Spawn Analysis</h1>
        <p className={styles.subtitle}>
          Heatmaps of Bloat hand spawn rates across Theatre of Blood raids.
        </p>
      </div>
      <Card className={styles.mainPanel}>
        <BloatHands />
      </Card>
    </div>
  );
}

export const metadata: Metadata = {
  title: 'Bloat Hand Spawn Analysis',
  description:
    'Visualize trends in Bloat hand spawn patterns across Theatre of Blood raids ' +
    'recorded on Blert, Old School Runescape’s premier PvM tracker.',
};
