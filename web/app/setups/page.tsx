import { ResolvingMetadata } from 'next';
import Link from 'next/link';

import {
  getSetups,
  getCurrentUserSetups,
  type SetupCursor,
} from '@/actions/setup';
import Card from '@/components/card';

import { FilterableSetupList } from './filterable-setup-list';
import LocalSetupsList from './local-setups-list';
import { cursorFromParam } from './query';
import { StaticSetupList } from './static-setup-list';

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
    parsedCursor = cursorFromParam(sortBy, 'forward', after);
  } else if (before) {
    parsedCursor = cursorFromParam(sortBy, 'backward', before);
  }

  const filter = {
    state: 'published' as const,
    challenge:
      challenge !== undefined ? parseInt(challenge) : undefined,
    orderBy: sort === 'score' || sort === 'views' ? sort : 'latest',
    search,
    scale: scale !== undefined ? parseInt(scale) : undefined,
    sort: 'latest' as const,
  };

  const [userSetups, publicSetups] = await Promise.all([
    getCurrentUserSetups(SETUPS_PER_PAGE),
    getSetups(filter, parsedCursor, SETUPS_PER_PAGE),
  ]);

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
                action: (
                  <Link href="/setups/my" className={styles.viewAllLink}>
                    View All ({userSetups.total})
                    <i className="fas fa-arrow-right" />
                  </Link>
                ),
              }}
              className={styles.userSetupsCard}
            >
              {userSetups.setups.length > 0 ? (
                <StaticSetupList
                  setups={userSetups.setups}
                  showState
                  className={styles.userSetups}
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

        {!userSetups && (
          <div className={styles.userSetupsSection}>
            <LocalSetupsList />
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
            <FilterableSetupList
              initialData={publicSetups}
              initialFilters={filter}
              limit={SETUPS_PER_PAGE}
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
    'Browse the best community-created Old School RuneScape gear setups for ' +
    'the Theatre of Blood, Chambers of Xeric, Tombs of Amascut, Inferno, and ' +
    'Colosseum. Compare loadouts, filter by scale, and optimize your PvM ' +
    'performance.';

  return {
    title: 'OSRS Community Gear Setups - PvM Loadouts for ToB, CoX, ToA & More',
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
