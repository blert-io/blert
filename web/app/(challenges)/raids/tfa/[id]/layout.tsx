import { ChallengeType } from '@blert/common';
import { Metadata, ResolvingMetadata } from 'next';

import { findChallenges } from '@/actions/challenge';
import ChallengeNav from '@/components/challenge-nav';
import { scaleNameAndColor, statusNameAndColor } from '@/utils/challenge';
import { challengePageDescription } from '@/utils/challenge-description';
import { ticksToFormattedSeconds } from '@/utils/tick';

import { TfaContextProvider } from '../context';

import styles from './style.module.scss';

type RaidParams = {
  id: string;
};

type RaidLayoutProps = {
  params: Promise<RaidParams>;
  children: React.ReactNode;
};

export default async function RaidLayout({
  params,
  children,
}: RaidLayoutProps) {
  const { id } = await params;

  return (
    <div className={styles.raid}>
      <TfaContextProvider raidId={id}>
        <ChallengeNav challengeId={id} />
        <div className={styles.content}>{children}</div>
      </TfaContextProvider>
    </div>
  );
}

export async function generateMetadata(
  { params }: RaidLayoutProps,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { id } = await params;

  const [[challenges], metadata] = await Promise.all([
    findChallenges(null, { uuid: [id], type: ['==', ChallengeType.TFA] }),
    parent,
  ]);

  const raid = challenges[0] ?? null;
  if (raid === null) {
    return { title: 'Not Found' };
  }

  const [overallStatus] = statusNameAndColor(raid.status, raid.stage);
  const [scaleName] = scaleNameAndColor(raid.scale);

  let title = '';
  if (raid.overallTicks !== null) {
    title = `${ticksToFormattedSeconds(raid.overallTicks)} `;
  }
  title += `${scaleName} TFA ${overallStatus}`;

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
