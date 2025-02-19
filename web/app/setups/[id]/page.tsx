import { ResolvingMetadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { auth } from '@/auth';
import {
  getSetupByPublicId,
  getCurrentVote,
  loadSetupData,
  incrementSetupViews,
} from '@/actions/setup';
import { getRequestIp } from '@/utils/headers';

import SetupActions from './actions';
import Panels from './panels';
import { SetupViewingContextProvider } from '../viewing-context';
import VoteBar from '../vote-bar';

import setupStyles from '../style.module.scss';
import styles from './style.module.scss';

type GearSetupProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ player?: string; revision?: string }>;
};

export default async function GearSetupPage({
  params,
  searchParams,
}: GearSetupProps) {
  const [{ id }, { player, revision }] = await Promise.all([
    params,
    searchParams,
  ]);

  const setup = await getSetupByPublicId(id);
  if (setup === null || setup.latestRevision === null) {
    notFound();
  }

  let targetRevision = setup.latestRevision.version;
  if (revision) {
    const revisionNumber = parseInt(revision);
    if (!isNaN(revisionNumber)) {
      targetRevision = revisionNumber;
    }
  }

  const gearSetup = await loadSetupData(id, targetRevision);
  if (gearSetup === null) {
    notFound();
  }

  let highlightedPlayer = player ? parseInt(player) - 1 : null;
  if (
    highlightedPlayer !== null &&
    (highlightedPlayer < 0 || highlightedPlayer >= gearSetup.players.length)
  ) {
    highlightedPlayer = null;
  }

  const headersList = await headers();
  const ip = getRequestIp(headersList);

  const [session, currentVote] = await Promise.all([
    auth(),
    getCurrentVote(id),
    incrementSetupViews(id, ip),
  ]);

  const loggedIn = session !== null;
  const isAuthor =
    session !== null && parseInt(session.user.id ?? '0') === setup.authorId;

  const isLatestRevision = targetRevision === setup.latestRevision.version;

  return (
    <SetupViewingContextProvider initialHighlightedPlayer={highlightedPlayer}>
      <div className={styles.setupPage}>
        <div className={`${setupStyles.panel} ${styles.header}`}>
          <div className={styles.metadata}>
            <h1>{gearSetup.title}</h1>
            {!isLatestRevision && (
              <div className={styles.revisionBanner}>
                You are viewing an older revision of this setup.{' '}
                <Link href={`/setups/${setup.publicId}`}>
                  View latest version
                </Link>
              </div>
            )}
            <div className={styles.info}>
              <div className={styles.author}>
                by <span className={styles.username}>{setup.author}</span>
              </div>
              <div className={styles.version}>v{targetRevision}</div>
              <VoteBar
                publicId={setup.publicId}
                initialLikes={setup.likes}
                initialDislikes={setup.dislikes}
                initialVote={currentVote}
                disabled={!loggedIn || isAuthor || !isLatestRevision}
                width={300}
              />
            </div>
          </div>
          <SetupActions
            showClone={loggedIn}
            showDelete={isAuthor}
            showEdit={isAuthor && isLatestRevision}
            setup={setup}
            gearSetup={gearSetup}
          />
          <div className={styles.description}>
            <p>{gearSetup.description}</p>
          </div>
        </div>
        <Panels
          setupMetadata={setup}
          gearSetup={gearSetup}
          currentRevision={targetRevision}
        />
      </div>
    </SetupViewingContextProvider>
  );
}

export async function generateMetadata(
  { params }: GearSetupProps,
  parent: ResolvingMetadata,
) {
  const [{ id }, metadata] = await Promise.all([params, parent]);

  const setupMetadata = await getSetupByPublicId(id);
  if (setupMetadata === null || setupMetadata.latestRevision === null) {
    return {
      title: 'Gear setup not found',
    };
  }

  const setup = await loadSetupData(id, setupMetadata.latestRevision.version);
  if (setup === null) {
    return {
      title: 'Gear setup not found',
    };
  }

  const title = `${setup.title} by ${setupMetadata.author}`;
  let description = setup.description;

  if (description.length > 155) {
    description = description.slice(0, 155) + '…';
  }

  return {
    title,
    description,
    openGraph: { ...metadata.openGraph, title, description },
    twitter: {
      ...metadata.twitter,
      title,
    },
  };
}
