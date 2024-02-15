'use client';

import { CollapsiblePanel } from '../collapsible-panel/collapsible-panel';
import styles from './styles.module.scss';

export function BossPageReplay() {
  return (
    <CollapsiblePanel
      panelTitle={'Room Replay'}
      maxPanelHeight={500}
      defaultExpanded={true}
      className={styles.replay}
    >
      <h1 className={styles.preview}>Room Replay Goes Here</h1>
    </CollapsiblePanel>
  );
}
