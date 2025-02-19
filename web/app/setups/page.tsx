import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';
import Link from 'next/link';

import {
  getSetups,
  getCurrentUserSetups,
  type SetupCursor,
  type SetupSort,
} from '@/actions/setup';

import { cursorFromParam } from './query';
import { SetupList } from './setup-list';

import styles from './page.module.scss';

type SetupsPageProps = {
  searchParams: Promise<{
    after?: string;
    before?: string;
    challenge?: string;
    sort?: string;
    search?: string;
    scale?: string;
  }>;
};

const SETUPS_PER_PAGE = 10;

export default async function SetupsPage({ searchParams }: SetupsPageProps) {
  const { after, before, challenge, sort, search, scale } = await searchParams;

  let parsedCursor: SetupCursor | null = null;

  let sortBy = sort ?? 'latest';
  if (sortBy !== 'latest' && sortBy !== 'score' && sortBy !== 'views') {
    sortBy = 'latest';
  }

  if (after) {
    parsedCursor = cursorFromParam(sortBy as SetupSort, 'forward', after);
  } else if (before) {
    parsedCursor = cursorFromParam(sortBy as SetupSort, 'backward', before);
  }

  const filter = {
    state: 'published' as const,
    challenge:
      challenge !== undefined
        ? (parseInt(challenge) as ChallengeType)
        : undefined,
    orderBy: (sort === 'score' || sort === 'views' ? sort : 'latest') as
      | 'score'
      | 'views'
      | 'latest',
    search,
    scale: scale !== undefined ? parseInt(scale) : undefined,
  };

  const [userSetups, publicSetups] = await Promise.all([
    getCurrentUserSetups(SETUPS_PER_PAGE),
    getSetups(filter, parsedCursor, SETUPS_PER_PAGE),
  ]);

  const position = before
    ? publicSetups.remaining - SETUPS_PER_PAGE
    : publicSetups.total - publicSetups.remaining;

  return (
    <div className={styles.setupsPage}>
      <div className={styles.title}>
        <h1>Gear Setups</h1>
        <Link href="/setups/new">
          <i className="fas fa-plus" />
          <span>New setup</span>
        </Link>
      </div>
      <div className={styles.sections}>
        {userSetups && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>Your setups</h2>
              <Link href="/setups/my" className={styles.showAll}>
                Show all
              </Link>
            </div>
            {userSetups.setups.length > 0 ? (
              <SetupList
                setups={userSetups.setups}
                showState
                className={styles.userSetups}
                position={0}
                total={userSetups.total}
                limit={SETUPS_PER_PAGE}
              />
            ) : (
              <p>You have not yet created any setups.</p>
            )}
          </div>
        )}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>All setups</h2>
          </div>
          <SetupList
            setups={publicSetups.setups}
            nextCursor={publicSetups.nextCursor}
            prevCursor={publicSetups.prevCursor}
            currentFilter={filter}
            position={position}
            total={publicSetups.total}
            limit={SETUPS_PER_PAGE}
            showPagination
          />
        </div>
      </div>
    </div>
  );
}

export async function generateMetadata(
  _props: SetupsPageProps,
  parent: ResolvingMetadata,
) {
  const metadata = await parent;

  const description =
    'Browse community-created gear setups for various PvM challenges in Old School RuneScape.';

  return {
    title: 'Gear Setups',
    description,
    twitter: {
      ...metadata.twitter,
      description,
    },
    openGraph: {
      ...metadata.openGraph,
      description,
    },
  };
}
