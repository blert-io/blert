import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';

import { basicMetadata } from '@/utils/metadata';
import ChallengePage from '../../challenge-page';

export default async function Page() {
  return <ChallengePage type={ChallengeType.TOB} />;
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: 'Theatre of Blood Activity — OSRS Raid Stats & Analytics',
    description:
      'Track recent Theatre of Blood raids with real-time session breakdowns, ' +
      "completion stats, and player activity. See who's raiding, how long " +
      "they lasted, and where they wiped on Blert, Old School RuneScape's " +
      'premier PvM tracker.',
  });
}

export const dynamic = 'force-dynamic';
