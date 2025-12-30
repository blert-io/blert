'use client';

import { useContext, useEffect, useMemo, useRef, useState } from 'react';

import AttackTimeline, {
  AttackTimelineProps,
} from '@/components/attack-timeline';
import Card from '@/components/card';
import Checkbox from '@/components/checkbox';
import Menu from '@/components/menu';
import Modal from '@/components/modal';
import { DisplayContext } from '@/display';
import { useSetting } from '@/utils/user-settings';

import styles from './styles.module.scss';

export function BossPageAttackTimeline(props: AttackTimelineProps) {
  const display = useContext(DisplayContext);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  const [showFullTimeline, setShowFullTimeline] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsMenuPosition, setSettingsMenuPosition] = useState({
    x: 0,
    y: 0,
  });
  const [width, setWidth] = useState(0);

  const [showKits, setShowKits] = useSetting<boolean>({
    key: 'timeline-show-kits',
    defaultValue: true,
  });
  const [showSpells, setShowSpells] = useSetting<boolean>({
    key: 'timeline-show-spells',
    defaultValue: true,
  });

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const menuItems = useMemo(
    () => [
      {
        label: 'timeline-show-spells',
        customAction: () => false,
        customElement: (
          <Checkbox
            className={styles.settingsCheckbox}
            label="Show spell icons"
            checked={showSpells}
            onChange={(checked) => setShowSpells(checked)}
            simple
          />
        ),
      },
      {
        label: 'timeline-show-kits',
        customAction: () => false,
        customElement: (
          <Checkbox
            className={styles.settingsCheckbox}
            label="Show kitted weapons"
            checked={showKits}
            onChange={(checked) => setShowKits(checked)}
            simple
          />
        ),
      },
    ],
    [showSpells, showKits, setShowSpells, setShowKits],
  );

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

  const openSettings = () => {
    if (settingsButtonRef.current) {
      const rect = settingsButtonRef.current.getBoundingClientRect();
      setSettingsMenuPosition({
        x: rect.x + rect.width - settingsMenuWidth,
        y: rect.y + rect.height + 4,
      });
    }
    setShowSettings(true);
  };

  return (
    <Card
      className={styles.attackTimelineCard}
      fixed
      header={{
        title: 'Room Timeline',
        action: (
          <div className={styles.actionButtons}>
            <button onClick={() => setShowFullTimeline(true)}>
              <i className="fas fa-expand" />
              Expand
            </button>
            <button
              ref={settingsButtonRef}
              id="timeline-settings-button"
              onClick={openSettings}
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
        showSpells={showSpells}
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
        items={menuItems}
        width={settingsMenuWidth}
      />
    </Card>
  );
}
