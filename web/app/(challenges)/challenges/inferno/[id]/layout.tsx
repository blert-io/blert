import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';

import { loadChallenge } from '@/actions/challenge';
import ChallengeNav from '@/components/challenge-nav';
import { statusNameAndColor } from '@/utils/challenge';
import { challengePageDescription } from '@/utils/challenge-description';

import { InfernoContextProvider } from '../context';

import styles from './style.module.scss';

type InfernoParams = {
  id: string;
};

type InfernoLayoutProps = {
  params: Promise<InfernoParams>;
  children: React.ReactNode;
};

export default async function InfernoLayout(props: InfernoLayoutProps) {
  const { id } = await props.params;

  return (
    <InfernoContextProvider challengeId={id}>
      <ChallengeNav challengeId={id} />
      <div className={styles.content}>{props.children}</div>
    </InfernoContextProvider>
  );
}

export async function generateMetadata(
  { params }: InfernoLayoutProps,
  parent: ResolvingMetadata,
) {
  const { id } = await params;
  const [challenge, metadata] = await Promise.all([
    loadChallenge(ChallengeType.INFERNO, id),
    parent,
  ]);

  if (challenge === null) {
    return { title: 'Not Found' };
  }

  const [overallStatus] = statusNameAndColor(challenge.status, challenge.stage);

  const title = `Inferno ${overallStatus}`;
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
