'use client';

import { useContext, useEffect, useRef, useState } from 'react';

import AttackTimeline, {
  AttackTimelineProps,
} from '@/components/attack-timeline';
import Card from '@/components/card';
import Checkbox from '@/components/checkbox';
import Menu from '@/components/menu';
import Modal from '@/components/modal';
import { DisplayContext } from '@/display';

import styles from './styles.module.scss';

export function BossPageAttackTimeline(props: AttackTimelineProps) {
  const display = useContext(DisplayContext);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  const [showFullTimeline, setShowFullTimeline] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [width, setWidth] = useState(0);

  const [showKits, setShowKits] = useState(true);

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
          normalizeItems={!showKits}
          wrapWidth={timelineWidth}
          cellSize={display.isFull() ? 32 : 24}
        />
      </div>
    );
  }

  const settingsMenuWidth = 200;
  let settingsMenuPosition = {
    x: 0,
    y: 0,
  };
  if (settingsButtonRef.current) {
    const rect = settingsButtonRef.current.getBoundingClientRect();
    settingsMenuPosition = {
      x: rect.x + rect.width - settingsMenuWidth,
      y: rect.y + rect.height,
    };
  }

  return (
    <Card
      className={styles.attackTimelineCard}
      header={{
        title: 'Room Timeline',
        action: (
          <div className={styles.actionButtons}>
            <button
              className={styles.expandButton}
              onClick={() => setShowFullTimeline(true)}
            >
              <i className="fas fa-expand" />
              Expand
            </button>
            <button
              ref={settingsButtonRef}
              className={styles.settingsButton}
              id="timeline-settings-button"
              onClick={() => setShowSettings(true)}
            >
              <i className="fas fa-cog" />
              Settings
            </button>
          </div>
        ),
        styles: { marginBottom: 0 },
      }}
    >
      <AttackTimeline
        {...props}
        cellSize={cellSize}
        normalizeItems={!showKits}
      />
      <Modal
        open={showFullTimeline}
        onClose={() => setShowFullTimeline(false)}
        width={modalWidth}
      >
        {fullTimeline}
      </Modal>
      <Menu
        open={showSettings}
        onClose={() => setShowSettings(false)}
        position={settingsMenuPosition}
        items={[
          {
            label: 'Settings',
            customAction: () => false,
            customElement: (
              <Checkbox
                className={styles.settingsCheckbox}
                label="Show kits"
                checked={showKits}
                onChange={(checked) => setShowKits(checked)}
                simple
              />
            ),
          },
        ]}
        width={settingsMenuWidth}
      />
    </Card>
  );
}
