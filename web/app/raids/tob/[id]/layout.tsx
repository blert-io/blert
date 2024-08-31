import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';

import { loadChallenge } from '@/actions/challenge';
import { statusNameAndColor } from '@/components/raid-quick-details';
import { challengePageDescription } from '@/utils/challenge-description';
import { TobContextProvider } from '../context';

import styles from './style.module.scss';

type RaidParams = {
  id: string;
};

type RaidLayoutProps = {
  params: RaidParams;
  children: React.ReactNode;
};

export default function RaidLayout(props: RaidLayoutProps) {
  return (
    <div className={styles.raid}>
      <TobContextProvider raidId={props.params.id}>
        <div className={styles.content}>{props.children}</div>
      </TobContextProvider>
    </div>
  );
}

export async function generateMetadata(
  { params }: RaidLayoutProps,
  parent: ResolvingMetadata,
) {
  const [raid, metadata] = await Promise.all([
    loadChallenge(ChallengeType.TOB, params.id),
    parent,
  ]);

  if (raid === null) {
    return { title: 'Not Found' };
  }

  const [overallStatus] = statusNameAndColor(raid.status, raid.stage);

  const title = `ToB ${overallStatus}`;
  const description = challengePageDescription(raid);

  return {
    title,
    description,
    openGraph: { ...metadata.openGraph, description },
    twitter: {
      ...metadata.twitter,
      title,
      description,
    },
  };
}
