'use client';

import { useState } from 'react';
import styles from './styles.module.scss';

interface CollapsiblePanelProps extends React.HTMLAttributes<HTMLDivElement> {
  panelTitle: string;
  maxPanelHeight: number;
  defaultExpanded: boolean;
  disableExpansion?: boolean;
  panelWidth?: number;
}

export function CollapsiblePanel(props: CollapsiblePanelProps) {
  const {
    panelTitle,
    maxPanelHeight,
    defaultExpanded,
    disableExpansion = false,
    panelWidth,
    children,
  } = props;
  const [expanded, setExpanded] = useState(defaultExpanded);

  let className = `${styles.collapsiblePanel}`;
  if (disableExpansion) {
    className += ` ${styles.nonExpandable}`;
  }

  return (
    <div
      className={className}
      style={{ width: panelWidth ? `${panelWidth}px` : 'auto' }}
    >
      <div
        className={styles.collapsiblePanelHeader}
        onClick={() => {
          if (disableExpansion) return;
          setExpanded(!expanded);
        }}
      >
        <div className={styles.collapsiblePanelTitle}>
          {disableExpansion !== true && (
            <i
              className={`fa-solid fa-chevron-down ${styles.collapsiblePanelIcon} ${expanded ? styles.collapsiblePanelIconExpanded : styles.collapsiblePanelIconCollapsed}`}
              style={{ marginRight: '15px' }}
            ></i>
          )}
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
