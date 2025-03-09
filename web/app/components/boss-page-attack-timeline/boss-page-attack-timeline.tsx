'use client';

import { useContext, useEffect, useState } from 'react';

import AttackTimeline, {
  AttackTimelineProps,
} from '@/components/attack-timeline';
import Card from '@/components/card';
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
    const paddingY = display.isCompact() ? 20 : 10;
    const paddingX = display.isCompact() ? 12 : 30;
    const timelineWidth = modalWidth - 2 * paddingX;

    fullTimeline = (
      <div
        className={styles.timelineModal}
        style={{ padding: `${paddingY}px ${paddingX}px` }}
      >
        <AttackTimeline
          {...props}
          wrapWidth={timelineWidth}
          cellSize={display.isFull() ? 32 : 24}
        />
      </div>
    );
  }

  return (
    <Card
      className={styles.attackTimelineCard}
      header={{
        title: 'Room Timeline',
        action: (
          <button
            className={styles.expandButton}
            onClick={() => setShowFullTimeline(true)}
          >
            <i className="fas fa-expand" />
            Expand
          </button>
        ),
        styles: { marginBottom: 0 },
      }}
    >
      <AttackTimeline {...props} cellSize={cellSize} />
      <Modal
        open={showFullTimeline}
        onClose={() => setShowFullTimeline(false)}
        width={modalWidth}
      >
        {fullTimeline}
      </Modal>
    </Card>
  );
}
