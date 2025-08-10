import { ResolvingMetadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { challengeName } from '@blert/common';

import { auth } from '@/auth';
import {
  getSetupByPublicId,
  getCurrentVote,
  loadSetupData,
  incrementSetupViews,
} from '@/actions/setup';
import Card from '@/components/card';
import Tooltip from '@/components/tooltip';
import { getRequestIp } from '@/utils/headers';

import SetupActions from './actions';
import CollapsibleDescription from './collapsible-description';
import Panels from './panels';
import { SetupViewingContextProvider } from '../viewing-context';
import VoteBar from '../vote-bar';

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
        <Card primary className={styles.headerCard}>
          <div className={styles.headerContent}>
            <div className={styles.metadata}>
              <h1>{gearSetup.title}</h1>
              {!isLatestRevision && (
                <div className={styles.revisionBanner}>
                  <i className="fas fa-info-circle" />
                  <span>
                    You are viewing an older revision of this setup.{' '}
                    <Link href={`/setups/${setup.publicId}`}>
                      View latest version
                    </Link>
                  </span>
                </div>
              )}
              <div className={styles.setupInfo}>
                <div className={styles.setupMeta}>
                  <span className={styles.author}>
                    <i className="fas fa-user" />
                    <span className={styles.username}>{setup.author}</span>
                  </span>
                  <span className={styles.challenge}>
                    <i className="fas fa-shield" />
                    {challengeName(gearSetup.challenge)}
                  </span>
                  <span className={styles.version}>
                    <i className="fas fa-code-branch" />v{targetRevision}
                  </span>
                  <span className={styles.views}>
                    <i className="fas fa-eye" />
                    <span>{setup.views.toLocaleString()}</span>
                  </span>
                </div>
                <div className={styles.voteSection}>
                  <VoteBar
                    publicId={setup.publicId}
                    initialLikes={setup.likes}
                    initialDislikes={setup.dislikes}
                    initialVote={currentVote}
                    disabled={!loggedIn || isAuthor || !isLatestRevision}
                    width={280}
                  />
                </div>
              </div>
            </div>
            <div className={styles.actionsSection}>
              <SetupActions
                showClone={loggedIn}
                showDelete={isAuthor}
                showEdit={isAuthor && isLatestRevision}
                setup={setup}
                gearSetup={gearSetup}
              />
            </div>
          </div>
          <CollapsibleDescription text={gearSetup.description} />
        </Card>

        <div className={styles.content}>
          <Panels
            setupMetadata={setup}
            gearSetup={gearSetup}
            currentRevision={targetRevision}
          />
        </div>
      </div>
      <Tooltip tooltipId="slot-tooltip">Hover an item</Tooltip>
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

  const title = `${setup.title} by ${setupMetadata.author} - PvM Loadout for ${challengeName(setup.challenge)}`;
  let description =
    `Explore ${setup.title}, a community gear setup for ${challengeName(
      setup.challenge,
    )} in Old School RuneScape. View equipment, inventories, and rune pouches ` +
    'to fine-tune your PvM strategy.';

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
