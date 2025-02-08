import { ResolvingMetadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { auth } from '@/auth';
import { getSetupByPublicId, getCurrentVote } from '@/actions/setup';
import Button from '@/components/button';

import Panels from './panels';
import { SetupViewingContextProvider } from '../viewing-context';
import VoteBar from '../vote-bar';

import setupStyles from '../style.module.scss';
import styles from './style.module.scss';

type GearSetupProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ player?: string }>;
};

export default async function GearSetupPage({
  params,
  searchParams,
}: GearSetupProps) {
  const [{ id }, { player }] = await Promise.all([params, searchParams]);

  const setup = await getSetupByPublicId(id);
  if (setup === null || setup.latestRevision === null) {
    notFound();
  }

  let highlightedPlayer = player ? parseInt(player) - 1 : null;
  if (
    highlightedPlayer !== null &&
    (highlightedPlayer < 0 ||
      highlightedPlayer >= setup.latestRevision.setup.players.length)
  ) {
    highlightedPlayer = null;
  }

  const [session, currentVote] = await Promise.all([
    auth(),
    getCurrentVote(id),
  ]);

  const loggedIn = session !== null;
  const isAuthor =
    session !== null && parseInt(session.user.id ?? '0') === setup.authorId;
  const { setup: gearSetup } = setup.latestRevision;

  return (
    <SetupViewingContextProvider initialHighlightedPlayer={highlightedPlayer}>
      <div className={styles.setupPage}>
        <div className={`${setupStyles.panel} ${styles.header}`}>
          <div className={styles.metadata}>
            <h1>{gearSetup.title}</h1>
            <div className={styles.info}>
              <div className={styles.author}>
                by <span className={styles.username}>{setup.author}</span>
              </div>
              <div className={styles.version}>
                v{setup.latestRevision.version}
              </div>
              <VoteBar
                publicId={setup.publicId}
                initialLikes={setup.likes}
                initialDislikes={setup.dislikes}
                initialVote={currentVote}
                disabled={!loggedIn || isAuthor}
                width={300}
              />
            </div>
          </div>
          <div className={styles.actions}>
            {isAuthor && (
              <Link href={`/setups/${setup.publicId}/edit`}>
                <i className="fas fa-pencil-alt" />
                <span>Edit</span>
              </Link>
            )}
            <Button>
              <i className="fas fa-download" />
              <span style={{ marginLeft: 8 }}>Export…</span>
            </Button>
          </div>
          <div className={styles.description}>
            <p>{gearSetup.description}</p>
          </div>
        </div>
        <Panels setup={setup} />
      </div>
    </SetupViewingContextProvider>
  );
}

export async function generateMetadata(
  { params }: GearSetupProps,
  parent: ResolvingMetadata,
) {
  const [{ id }, metadata] = await Promise.all([params, parent]);

  const setup = await getSetupByPublicId(id);
  if (setup === null || setup.latestRevision === null) {
    return {
      title: 'Gear setup not found',
    };
  }

  const title = `${setup.latestRevision.setup.title} by ${setup.author}`;
  let description = setup.latestRevision.setup.description;

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
