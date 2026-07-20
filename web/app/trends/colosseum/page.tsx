import { ResolvingMetadata } from 'next';
import { Suspense } from 'react';

import { getConnectedPlayers } from '@/actions/users';
import Card from '@/components/card';
import Loading from '@/components/loading';
import { basicMetadata } from '@/utils/metadata';

import WaveTimes from './wave-times';

import styles from './style.module.scss';

export default async function ColosseumWaveTimesPage() {
  const connectedPlayers = await getConnectedPlayers().catch(() => []);

  return (
    <div className={styles.colosseumWaves}>
      <Card primary className={styles.header}>
        <h1>Colosseum Wave Times</h1>
        <p className={styles.subtitle}>
          Analyze time percentiles across Colosseum runs
        </p>
      </Card>
      <Card className={styles.mainPanel}>
        <Suspense fallback={<Loading />}>
          <WaveTimes connectedPlayers={connectedPlayers} />
        </Suspense>
      </Card>
    </div>
  );
}

export async function generateMetadata(
  _props: unknown,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'OSRS Colosseum Wave Times',
    description:
      'Explore wave time percentiles across Fortis Colosseum runs recorded ' +
      'on Blert, Old School RuneScape’s premier PvM tracker.',
  });
}
