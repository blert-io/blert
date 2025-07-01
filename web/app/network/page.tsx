import { ResolvingMetadata } from 'next';
import { Suspense } from 'react';

import Card from '@/components/card';
import { basicMetadata } from '@/utils/metadata';

import NetworkContent from './network-content';

import styles from './style.module.scss';

export default function NetworkPage() {
  return (
    <div className={styles.networkPage}>
      <Card className={styles.pageHeader} primary>
        <div className={styles.headerContent}>
          <div className={styles.titleSection}>
            <div className={styles.iconWrapper}>
              <i className="fas fa-project-diagram" />
            </div>
            <div className={styles.titleText}>
              <h1>Player Network</h1>
              <p>
                Explore player connections and raid partnerships across the
                community
              </p>
            </div>
          </div>
        </div>
      </Card>

      <div className={styles.networkContainer}>
        <Suspense fallback={<NetworkSkeleton />}>
          <NetworkContent />
        </Suspense>
      </div>
    </div>
  );
}

function NetworkSkeleton() {
  return (
    <div className={styles.networkSkeleton}>
      <div className={styles.skeletonControls} />
      <div className={styles.skeletonGraph} />
    </div>
  );
}

export async function generateMetadata(_params: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: 'Player Network — OSRS Raid Connections & Partnerships',
    description:
      'Explore the Player Network on Blert.io to visualize raid connections ' +
      'and partnerships across the Old School RuneScape community. ' +
      'Discover who raids with whom, identify top collaborators, and analyze ' +
      'the dynamics of high-level PvM teamwork — all with interactive filters ' +
      'and advanced graph analytics.',
  });
}
