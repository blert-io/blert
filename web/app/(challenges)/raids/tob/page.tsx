import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';

import { basicMetadata } from '@/utils/metadata';
import ChallengePage from '@/(challenges)/challenge-page';
import { AnalysisLink } from '@/(challenges)/types';

const TOB_ANALYSIS_LINKS: AnalysisLink[] = [
  {
    href: '/tools/split-calc',
    title: 'Split Calculator',
    description: 'Statistically analyze ToB room times with raid data',
    icon: 'fas fa-calculator',
  },
];

export default function Page() {
  return (
    <ChallengePage
      type={ChallengeType.TOB}
      analysisLinks={TOB_ANALYSIS_LINKS}
    />
  );
}

export async function generateMetadata(
  _props: Record<string, never>,
  parent: ResolvingMetadata,
) {
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
