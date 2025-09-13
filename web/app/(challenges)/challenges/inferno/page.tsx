import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';

import { basicMetadata } from '@/utils/metadata';
import ChallengePage from '../../challenge-page';

export default async function Page() {
  return <ChallengePage type={ChallengeType.INFERNO} />;
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: 'Inferno Activity — OSRS Raid Stats & Analytics',
    description:
      'Track recent Inferno runs with real-time session breakdowns, ' +
      "completion stats, and player activity. See who's running, how long " +
      "they lasted, and where they wiped on Blert, Old School RuneScape's " +
      'premier PvM tracker.',
  });
}

export const dynamic = 'force-dynamic';
