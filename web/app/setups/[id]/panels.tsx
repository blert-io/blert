'use client';

import { SetupMetadata } from '@/actions/setup';
import { useWidthThreshold } from '@/display';

import { Player } from '../player';
import ItemCounts from '../item-counts';

import setupStyles from '../style.module.scss';
import styles from './style.module.scss';

type GearSetupProps = {
  setup: SetupMetadata;
};

export default function GearSetupPanels({ setup }: GearSetupProps) {
  const { setup: gearSetup } = setup.latestRevision!;

  const renderAsRow = useWidthThreshold(1800);

  const playersPanel = (
    <div
      className={`${setupStyles.panel} ${setupStyles.players} ${styles.players}`}
      key="players"
    >
      {gearSetup.players.map((player, i) => (
        <div key={i} className={styles.player}>
          <Player index={i} player={player} />
        </div>
      ))}
    </div>
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
        <span className={styles.current}>v{setup.latestRevision!.version}</span>
      </div>
      <div className={styles.revisionMessage}>
        {setup.latestRevision!.message ?? 'No message provided.'}
      </div>
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
