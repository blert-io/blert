import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  getSetups,
  type SetupCursor,
  type SetupSort,
  type SetupState,
} from '@/actions/setup';
import { getSignedInUser } from '@/actions/users';
import Card from '@/components/card';

import { LocalSetupMigrator } from './local-setup-migrator';
import { cursorFromParam } from '../query';
import { SetupList } from '../setup-list';

import styles from '../page.module.scss';

const SETUPS_PER_PAGE = 20;

type MySetupsPageProps = {
  searchParams: Promise<{
    after?: string;
    before?: string;
    challenge?: string;
    sort?: SetupSort;
    state?: SetupState;
    search?: string;
    scale?: string;
  }>;
};

export default async function MySetupsPage({
  searchParams,
}: MySetupsPageProps) {
  const user = await getSignedInUser();
  if (user === null) {
    redirect('/login?next=/setups/my');
  }

  const { after, before, challenge, sort, state, search, scale } =
    await searchParams;

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
    author: user.id,
    challenge:
      challenge !== undefined
        ? (parseInt(challenge) as ChallengeType)
        : undefined,
    orderBy: (sort === 'score' || sort === 'views' ? sort : 'latest') as
      | 'score'
      | 'views'
      | 'latest',
    state: state as SetupState | undefined,
    search,
    scale: scale !== undefined ? parseInt(scale) : undefined,
  };

  const setups = await getSetups(filter, parsedCursor, SETUPS_PER_PAGE);
  if (setups === null) {
    redirect('/login?next=/setups/my');
  }

  const position = before
    ? setups.remaining - SETUPS_PER_PAGE
    : setups.total - setups.remaining;

  return (
    <div className={`${styles.setupsPage} ${styles.mySetups}`}>
      <Card primary className={styles.pageHeader}>
        <div className={styles.headerContent}>
          <div className={styles.titleSection}>
            <h1>Your Setups</h1>
            <p className={styles.subtitle}>
              Manage and organize your personal gear setups collection
            </p>
          </div>
          <Link href="/setups/new" className={styles.createButton}>
            <i className="fas fa-plus" />
            <span>Create Setup</span>
          </Link>
        </div>
      </Card>

      <LocalSetupMigrator />

      <div className={styles.content}>
        <div className={styles.publicSetupsSection}>
          <Card
            header={{
              title: (
                <div className={styles.sectionTitle}>
                  <i className="fas fa-user-gear" />
                  Setup Management
                </div>
              ),
            }}
            className={styles.publicSetupsCard}
          >
            <SetupList
              setups={setups.setups}
              nextCursor={setups.nextCursor}
              prevCursor={setups.prevCursor}
              currentFilter={filter}
              showState
              showPagination
              showStateFilter
              showSearch
              position={position}
              total={setups.total}
              limit={SETUPS_PER_PAGE}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

export async function generateMetadata(
  _props: MySetupsPageProps,
  parent: ResolvingMetadata,
) {
  const metadata = await parent;

  const description = 'View and manage your gear setups.';

  return {
    title: 'Your Setups',
    description,
    twitter: {
      ...metadata.twitter,
      description,
    },
    openGraph: {
      ...metadata.openGraph,
      description,
      title: 'Your Setups',
    },
  };
}
