import { ChallengeType } from '@blert/common';
import { Metadata, ResolvingMetadata } from 'next';

import { basicMetadata } from '@/utils/metadata';
import ChallengePage from '@/(challenges)/challenge-page';

export default function Page() {
  return <ChallengePage type={ChallengeType.TFA} />;
}

export async function generateMetadata(
  _props: Record<string, never>,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  return basicMetadata(await parent, {
    title: 'The Fractured Archive Activity — OSRS Raid Stats & Analytics',
    description:
      'Track recent Fractured Archive raids with real-time session breakdowns, ' +
      "completion stats, and player activity. See who's raiding, how long " +
      "they lasted, and where they wiped on Blert, Old School RuneScape's " +
      'premier PvM tracker.',
  });
}

export const dynamic = 'force-dynamic';
