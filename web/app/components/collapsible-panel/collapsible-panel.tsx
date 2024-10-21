'use client';

import { useContext, useState } from 'react';

import { DisplayContext } from '@/display';

import styles from './styles.module.scss';

interface CollapsiblePanelProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  contentClassName?: string;
  panelTitle: string;
  defaultExpanded?: boolean | 'fullDisplay';
  disableExpansion?: boolean;
  panelWidth?: number | string;
  maxPanelWidth?: number | string;
  maxPanelHeight: number;
}

export function CollapsiblePanel(props: CollapsiblePanelProps) {
  const {
    panelTitle,
    maxPanelHeight,
    defaultExpanded = false,
    disableExpansion = false,
    panelWidth,
    maxPanelWidth,
    children,
  } = props;
  let startExpanded = false;

  const display = useContext(DisplayContext);

  if (defaultExpanded === 'fullDisplay') {
    startExpanded = display.isFull();
  } else {
    startExpanded = defaultExpanded;
  }

  const [expanded, setExpanded] = useState(startExpanded || disableExpansion);

  let className = `${styles.collapsiblePanel}`;
  if (disableExpansion) {
    className += ` ${styles.nonExpandable}`;
  }
  if (props.className) {
    className += ` ${props.className}`;
  }

  let contentClassName = `${styles.collapsiblePanelContents}`;
  if (props.contentClassName) {
    contentClassName += ` ${props.contentClassName}`;
  }
  if (expanded) {
    contentClassName += ` ${styles.collapsiblePanelContentsExpanded}`;
  } else {
    contentClassName += ` ${styles.collapsiblePanelContentsCollapsed}`;
  }

  return (
    <div
      className={className}
      style={{ width: panelWidth ?? 'fit-content', maxWidth: maxPanelWidth }}
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
        className={contentClassName}
        style={{
          maxHeight: expanded ? `${maxPanelHeight}px` : '0px',
        }}
      >
        {children}
      </div>
    </div>
  );
}
