'use client';

import { useState } from 'react';
import styles from './styles.module.scss';

interface CollapsiblePanelProps extends React.HTMLAttributes<HTMLDivElement> {
  panelTitle: string;
  maxPanelHeight: number;
  defaultExpanded: boolean;
}

export function CollapsiblePanel(props: CollapsiblePanelProps) {
  const { panelTitle, maxPanelHeight, defaultExpanded, children } = props;
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={styles.collapsiblePanel}>
      <div
        className={styles.collapsiblePanelHeader}
        onClick={() => {
          setExpanded(!expanded);
        }}
      >
        <div className={styles.collapsiblePanelTitle}>
          <i
            className={`fa-solid fa-chevron-down ${styles.collapsiblePanelIcon} ${expanded ? styles.collapsiblePanelIconExpanded : styles.collapsiblePanelIconCollapsed}`}
            style={{ marginRight: '15px' }}
          ></i>
          {panelTitle}
        </div>
      </div>
      <div
        className={`${styles.collapsiblePanelContents} ${expanded ? styles.collapsiblePanelContentsExpanded : styles.collapsiblePanelContentsCollapsed}`}
        style={{
          maxHeight: expanded ? `${maxPanelHeight}px` : '0px',
        }}
      >
        {children}
      </div>
    </div>
  );
}
