'use client';

import { CollapsiblePanel } from '../collapsible-panel/collapsible-panel';
import styles from './styles.module.scss';

export function BossPageDPSTimeline() {
  return (
    <CollapsiblePanel
      panelTitle={'DPS Timeline'}
      maxPanelHeight={300}
      defaultExpanded={true}
      className={styles.dpsTImeline}
    >
      <h1 className={styles.preview}>DPS Timeline Graph Goes Here</h1>
    </CollapsiblePanel>
  );
}
