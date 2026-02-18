import { ResolvingMetadata } from 'next';
import { Suspense } from 'react';

import Card from '@/components/card';
import Loading from '@/components/loading';
import { basicMetadata } from '@/utils/metadata';

import { SplitCalculator } from './split-calculator';

import styles from './style.module.scss';

export default function SplitCalcPage() {
  return (
    <div className={styles.page}>
      <Card primary className={styles.header}>
        <h1>Split Calculator</h1>
        <p className={styles.subtitle}>
          Analyze Theatre of Blood room splits with statistical insights powered
          by real raid data.
        </p>
      </Card>
      <Suspense fallback={<Loading />}>
        <SplitCalculator />
      </Suspense>
    </div>
  );
}

export async function generateMetadata(
  _props: Record<string, never>,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'Split Calculator',
    description:
      'Analyze Theatre of Blood room splits with statistical insights. ' +
      'Calculate raid probabilities and inspect distribution patterns.',
  });
}
