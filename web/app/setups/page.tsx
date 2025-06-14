import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';
import Link from 'next/link';

import {
  getSetups,
  getCurrentUserSetups,
  type SetupCursor,
  type SetupSort,
} from '@/actions/setup';
import Card from '@/components/card';

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
      <Card primary className={styles.pageHeader}>
        <div className={styles.headerContent}>
          <div className={styles.titleSection}>
            <h1>Gear Setups</h1>
            <p className={styles.subtitle}>
              Browse and create community gear setups for various PvM challenges
            </p>
          </div>
          <Link href="/setups/new" className={styles.createButton}>
            <i className="fas fa-plus" />
            <span>Create Setup</span>
          </Link>
        </div>
      </Card>

      <div className={styles.content}>
        {userSetups && (
          <div className={styles.userSetupsSection}>
            <Card
              header={{
                title: (
                  <div className={styles.sectionTitle}>
                    <i className="fas fa-user" />
                    Your Setups
                  </div>
                ),
                action: userSetups.total > SETUPS_PER_PAGE && (
                  <Link href="/setups/my" className={styles.viewAllLink}>
                    View All ({userSetups.total})
                    <i className="fas fa-arrow-right" />
                  </Link>
                ),
              }}
              className={styles.userSetupsCard}
            >
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
                <div className={styles.emptyState}>
                  <i className="fas fa-shield-halved" />
                  <h3>No setups yet</h3>
                  <p>
                    You haven’t created any gear setups. Start by creating your
                    first setup!
                  </p>
                  <Link href="/setups/new" className={styles.emptyStateButton}>
                    <i className="fas fa-plus" />
                    Create Your First Setup
                  </Link>
                </div>
              )}
            </Card>
          </div>
        )}

        <div className={styles.publicSetupsSection}>
          <Card
            header={{
              title: (
                <div className={styles.sectionTitle}>
                  <i className="fas fa-globe" />
                  Community Setups
                </div>
              ),
            }}
            className={styles.publicSetupsCard}
          >
            <SetupList
              setups={publicSetups.setups}
              nextCursor={publicSetups.nextCursor}
              prevCursor={publicSetups.prevCursor}
              currentFilter={filter}
              position={position}
              total={publicSetups.total}
              limit={SETUPS_PER_PAGE}
              showPagination
              showSearch
            />
          </Card>
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
