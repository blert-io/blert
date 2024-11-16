'use client';

import { useContext, useEffect, useState } from 'react';

import AttackTimeline, {
  AttackTimelineProps,
} from '@/components/attack-timeline';
import CollapsiblePanel from '@/components/collapsible-panel';
import Modal from '@/components/modal';
import { DisplayContext } from '@/display';

import styles from './styles.module.scss';

export function BossPageAttackTimeline(props: AttackTimelineProps) {
  const display = useContext(DisplayContext);

  const [showFullTimeline, setShowFullTimeline] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  let fullTimeline = null;
  let modalWidth = 0;

  let cellSize = props.cellSize;
  if (display.isCompact()) {
    cellSize = 24;
  }

  if (showFullTimeline) {
    modalWidth = Math.floor(width * 0.95);
    const timelineWidth = modalWidth - 2 * 40;

    fullTimeline = (
      <div className={styles.timelineModal}>
        <AttackTimeline
          {...props}
          wrapWidth={timelineWidth}
          cellSize={display.isFull() ? 32 : 24}
        />
      </div>
    );
  }

  return (
    <CollapsiblePanel
      panelTitle="Room Timeline"
      maxPanelHeight={1000}
      defaultExpanded={true}
      panelWidth="100%"
      className={styles.attackTimelinePanel}
    >
      <button
        className={styles.expandButton}
        onClick={() => setShowFullTimeline(true)}
      >
        <i className="fas fa-expand" />
        Expand
      </button>
      <AttackTimeline {...props} cellSize={cellSize} />
      <Modal
        open={showFullTimeline}
        onClose={() => setShowFullTimeline(false)}
        width={modalWidth}
      >
        {fullTimeline}
      </Modal>
    </CollapsiblePanel>
  );
}
