import { ChallengeMode, ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';

import { loadChallenge } from '@/actions/challenge';
import ChallengeNav from '@/components/challenge-nav';
import { statusNameAndColor } from '@/utils/challenge';
import { challengePageDescription } from '@/utils/challenge-description';
import { ticksToFormattedSeconds } from '@/utils/tick';

import { TobContextProvider } from '../context';

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
      <TobContextProvider raidId={id}>
        <ChallengeNav challengeId={id} />
        <div className={styles.content}>{children}</div>
      </TobContextProvider>
    </div>
  );
}

export async function generateMetadata(
  { params }: RaidLayoutProps,
  parent: ResolvingMetadata,
) {
  const { id } = await params;

  const [raid, metadata] = await Promise.all([
    loadChallenge(ChallengeType.TOB, id),
    parent,
  ]);

  if (raid === null) {
    return { title: 'Not Found' };
  }

  const [overallStatus] = statusNameAndColor(raid.status, raid.stage);

  let title = '';
  if (raid.challengeTicks > 0) {
    title = `${ticksToFormattedSeconds(raid.challengeTicks)} `;
  }

  switch (raid.scale) {
    case 1:
      title += 'Solo ';
      break;
    case 2:
      title += 'Duo ';
      break;
    case 3:
      title += 'Trio ';
      break;
    case 4:
      title += '4s ';
      break;
    case 5:
      title += '5s ';
      break;
  }

  switch (raid.mode) {
    case ChallengeMode.TOB_ENTRY:
      title += 'Entry Mode ';
      break;
    case ChallengeMode.TOB_HARD:
      title += 'Hard Mode ';
    default:
      title += 'Regular ';
      break;
  }

  title += `ToB ${overallStatus}`;

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
