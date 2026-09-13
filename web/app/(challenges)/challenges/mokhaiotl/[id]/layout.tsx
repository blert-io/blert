import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';

import { findChallenges } from '@/actions/challenge';
import ChallengeNav from '@/components/challenge-nav';
import { statusNameAndColor } from '@/utils/challenge';
import { challengePageDescription } from '@/utils/challenge-description';

import { MokhaiotlContextProvider } from '../context';

import styles from './style.module.scss';

type MokhaiotlParams = {
  id: string;
};

type MokhaiotlLayoutProps = {
  params: Promise<MokhaiotlParams>;
  children: React.ReactNode;
};

export default async function MokhaiotlLayout(props: MokhaiotlLayoutProps) {
  const { id } = await props.params;

  return (
    <MokhaiotlContextProvider challengeId={id}>
      <ChallengeNav challengeId={id} />
      <div className={styles.content}>{props.children}</div>
    </MokhaiotlContextProvider>
  );
}

export async function generateMetadata(
  { params }: MokhaiotlLayoutProps,
  parent: ResolvingMetadata,
) {
  const { id } = await params;
  const [[challenges], metadata] = await Promise.all([
    findChallenges(null, {
      uuid: [id],
      type: ['==', ChallengeType.MOKHAIOTL],
    }),
    parent,
  ]);

  const challenge = challenges[0] ?? null;
  if (challenge === null) {
    return { title: 'Not Found' };
  }

  const [overallStatus] = statusNameAndColor(challenge.status, challenge.stage);

  const title = `Doom of Mokhaiotl ${overallStatus}`;
  const description = challengePageDescription(challenge);

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
