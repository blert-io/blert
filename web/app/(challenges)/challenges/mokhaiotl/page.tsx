import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';

import { basicMetadata } from '@/utils/metadata';

import ChallengePage from '../../challenge-page';

export default function Page() {
  return <ChallengePage type={ChallengeType.MOKHAIOTL} />;
}

export async function generateMetadata(
  _props: Record<string, never>,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'Doom of Mokhaiotl Activity — OSRS Challenge Stats & Analytics',
    description:
      'Track recent Doom of Mokhaiotl delves with real-time session breakdowns, ' +
      "completion stats, and player activity. See who's delving, how deep " +
      "they progressed, and how they wiped on Blert, Old School RuneScape's " +
      'premier PvM tracker.',
  });
}

export const dynamic = 'force-dynamic';
