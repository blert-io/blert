import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';

import Card from '@/components/card';
import BloatIcon from '@/svg/bloat.svg';
import { basicMetadata } from '@/utils/metadata';

import ChallengeStats, { AnalysisLink } from './challenge-stats';

import styles from './style.module.scss';

// Define analysis links for each challenge type
const TOB_ANALYSIS_LINKS: AnalysisLink[] = [
  {
    href: '/trends/bloat-hands',
    title: 'Bloat Hand Spawn Analysis',
    description:
      'Detailed heatmaps and patterns of hand spawns during Bloat encounters',
    icon: <BloatIcon width={32} height={32} />,
  },
];

const COLOSSEUM_ANALYSIS_LINKS: AnalysisLink[] = [
  // Add Colosseum-specific analysis links here when they become available
];

export default function TrendsPage() {
  return (
    <div className={styles.trends}>
      <Card primary className={styles.header}>
        <h1>Data Trends & Analysis</h1>
        <p className={styles.subtitle}>
          Explore community performance data and detailed analysis tools
        </p>
      </Card>

      <div className={styles.challengeGrid}>
        <ChallengeStats
          challenge={ChallengeType.TOB}
          analysisLinks={TOB_ANALYSIS_LINKS}
        />
        <ChallengeStats
          challenge={ChallengeType.COLOSSEUM}
          analysisLinks={COLOSSEUM_ANALYSIS_LINKS}
        />
      </div>
    </div>
  );
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: 'OSRS Data Trends & Analysis',
    description:
      'Explore community performance data and detailed analysis tools on Blert, ' +
      'Old School RuneScape’s premier PvM tracker.',
  });
}
