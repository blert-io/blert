'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  SetupMetadata,
  SetupRevision,
  getSetupRevisions,
} from '@/actions/setup';
import { useWidthThreshold } from '@/display';

import ItemCounts from '../item-counts';
import PlayerList from '../player-list';
import { GearSetup } from '../setup';

import setupStyles from '../style.module.scss';
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

  useEffect(() => {
    getSetupRevisions(setupMetadata.publicId).then((revs) => {
      setRevisions(revs);
      setLoading(false);
    });
  }, [setupMetadata.publicId]);

  const renderAsRow = useWidthThreshold(1800);

  const playersPanel = (
    <PlayerList
      className={styles.players}
      key="players"
      players={gearSetup.players}
    />
  );

  const itemCountsPanel = (
    <div className={styles.itemCounts} key="item-counts">
      <ItemCounts setup={gearSetup} />
    </div>
  );

  const revisionsPanel = (
    <div className={`${setupStyles.panel} ${styles.revisions}`} key="revisions">
      <div className={styles.revisionHeader}>
        <h2>Revision history</h2>
        <span className={styles.current}>v{currentRevision}</span>
      </div>
      {loading ? (
        <div className={styles.loading}>Loading revisions…</div>
      ) : (
        <div className={styles.revisionList}>
          {revisions.map((revision) => (
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
  );

  let className = styles.panels;
  let panels;

  if (renderAsRow) {
    panels = [itemCountsPanel, playersPanel, revisionsPanel];
    className += ` ${styles.row}`;
  } else {
    panels = [playersPanel, itemCountsPanel, revisionsPanel];
  }

  return <div className={className}>{panels}</div>;
}
