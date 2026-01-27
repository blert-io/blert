import { ResolvingMetadata } from 'next';

import { getFollowing } from '@/actions/feed';
import { basicMetadata } from '@/utils/metadata';

import FollowingSection from './following-section';

const INITIAL_PAGE_SIZE = 30;

export default async function FollowingSettings() {
  const { players, totalCount, cursor } = await getFollowing({
    limit: INITIAL_PAGE_SIZE,
  });

  return (
    <FollowingSection
      initialPlayers={players}
      totalCount={totalCount}
      initialCursor={cursor}
    />
  );
}

export async function generateMetadata(
  _props: Record<string, never>,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'Following',
    description: 'Manage the players you follow on Blert.',
  });
}

export const dynamic = 'force-dynamic';
