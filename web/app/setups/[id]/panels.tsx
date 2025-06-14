'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChallengeType } from '@blert/common';

import {
  SetupMetadata,
  SetupRevision,
  getSetupRevisions,
} from '@/actions/setup';
import Card from '@/components/card';

import ItemCounts from '../item-counts';
import PlayerList from '../player-list';
import { GearSetup } from '../setup';

import styles from './style.module.scss';

type GearSetupProps = {
  setupMetadata: SetupMetadata;
  gearSetup: GearSetup;
  currentRevision: number;
};

export default function GearSetupPanels({
  setupMetadata,
  gearSetup,
  currentRevision,
}: GearSetupProps) {
  const [revisions, setRevisions] = useState<SetupRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllRevisions, setShowAllRevisions] = useState(false);

  useEffect(() => {
    getSetupRevisions(setupMetadata.publicId).then((revs) => {
      setRevisions(revs);
      setLoading(false);
    });
  }, [setupMetadata.publicId]);

  const maxPlayersPerRow = gearSetup.challenge === ChallengeType.TOB ? 5 : 4;

  const playersPanel = (
    <div className={styles.playersSection}>
      <PlayerList
        className={styles.players}
        key="players"
        players={gearSetup.players}
        maxPlayersPerRow={maxPlayersPerRow}
      />
    </div>
  );

  const itemCountsPanel = (
    <div className={styles.requiredItemsSection}>
      <div className={styles.itemCountsWrapper}>
        <ItemCounts setup={gearSetup} />
      </div>
    </div>
  );

  const visibleRevisions = showAllRevisions ? revisions : revisions.slice(0, 3);
  const hasMoreRevisions = revisions.length > 3;

  const revisionsPanel = (
    <Card
      header={{
        title: (
          <div className={styles.sectionTitle}>
            <i className="fas fa-history" />
            Revision History
          </div>
        ),
        action: hasMoreRevisions && (
          <button
            onClick={() => setShowAllRevisions(!showAllRevisions)}
            className={styles.toggleButton}
          >
            {showAllRevisions ? 'Show Less' : `Show All (${revisions.length})`}
            <i
              className={`fas fa-chevron-${showAllRevisions ? 'up' : 'down'}`}
            />
          </button>
        ),
      }}
      className={styles.revisionsSection}
    >
      <div className={styles.revisions}>
        <div className={styles.currentRevision}>
          <span className={styles.current}>Current: v{currentRevision}</span>
        </div>

        {loading ? (
          <div className={styles.loading}>
            <i className="fas fa-spinner" />
            Loading revisions…
          </div>
        ) : (
          <div className={styles.revisionList}>
            {visibleRevisions.map((revision) => (
              <div key={revision.version} className={styles.revision}>
                <div className={styles.revisionMeta}>
                  <div className={styles.revisionVersion}>
                    {revision.version === currentRevision ? (
                      <span>v{revision.version}</span>
                    ) : (
                      <Link
                        href={`/setups/${setupMetadata.publicId}?revision=${revision.version}`}
                      >
                        v{revision.version}
                      </Link>
                    )}
                  </div>
                  <div className={styles.revisionInfo}>
                    <div className={styles.revisionAuthor}>
                      by {revision.createdByUsername}
                    </div>
                    <div className={styles.revisionDate}>
                      {revision.createdAt.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                  </div>
                </div>
                <div className={styles.revisionMessage}>
                  {revision.message ?? 'No message provided.'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );

  return (
    <div className={styles.panels}>
      <div className={styles.mainContent}>
        {playersPanel}
        {itemCountsPanel}
        {revisionsPanel}
      </div>
    </div>
  );
}
