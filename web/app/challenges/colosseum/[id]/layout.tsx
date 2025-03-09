import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';

import { loadChallenge } from '@/actions/challenge';
import ChallengeNav from '@/components/challenge-nav';
import { statusNameAndColor } from '@/components/raid-quick-details';
import { challengePageDescription } from '@/utils/challenge-description';

import { ColosseumContextProvider } from '../context';

import styles from './style.module.scss';

type ColosseumParams = {
  id: string;
};

type ColosseumLayoutProps = {
  params: Promise<ColosseumParams>;
  children: React.ReactNode;
};

export default async function ColosseumLayout(props: ColosseumLayoutProps) {
  const { id } = await props.params;

  return (
    <ColosseumContextProvider challengeId={id}>
      <ChallengeNav challengeId={id} />
      <div className={styles.content}>{props.children}</div>
    </ColosseumContextProvider>
  );
}

export async function generateMetadata(
  { params }: ColosseumLayoutProps,
  parent: ResolvingMetadata,
) {
  const { id } = await params;
  const [challenge, metadata] = await Promise.all([
    loadChallenge(ChallengeType.COLOSSEUM, id),
    parent,
  ]);

  if (challenge === null) {
    return { title: 'Not Found' };
  }

  const [overallStatus] = statusNameAndColor(challenge.status, challenge.stage);

  const title = `Colosseum ${overallStatus}`;
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
