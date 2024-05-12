import { ResolvingMetadata } from 'next';
import { ColosseumContextProvider } from '../context';

import styles from './style.module.scss';
import { loadChallenge } from '@/actions/challenge';
import { ChallengeType } from '@blert/common';
import { raidStatusNameAndColor } from '@/components/raid-quick-details';
import { challengePageDescription } from '@/utils/challenge-description';

type ColosseumParams = {
  id: string;
};

type ColosseumLayoutProps = {
  params: ColosseumParams;
  children: React.ReactNode;
};

export default function ColosseumLayout(props: ColosseumLayoutProps) {
  const id = props.params.id;

  return (
    <ColosseumContextProvider challengeId={id}>
      <div className={styles.content}>{props.children}</div>
    </ColosseumContextProvider>
  );
}

export async function generateMetadata(
  { params }: ColosseumLayoutProps,
  parent: ResolvingMetadata,
) {
  const [challenge, metadata] = await Promise.all([
    loadChallenge(ChallengeType.COLOSSEUM, params.id),
    parent,
  ]);

  if (challenge === null) {
    return { title: 'Not Found' };
  }

  const [overallStatus] = raidStatusNameAndColor(
    challenge.status,
    challenge.stage,
  );

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
