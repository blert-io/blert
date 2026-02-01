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
  const cardRef = useRef<HTMLDivElement>(null);

  const [showFullTimeline, setShowFullTimeline] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsMenuPosition, setSettingsMenuPosition] = useState({
    x: 0,
    y: 0,
  });
  const [cardWidth, setCardWidth] = useState(0);

  const [showKits, setShowKits] = useSetting<boolean>({
    key: 'timeline-show-kits',
    defaultValue: true,
  });
  const [showSpells, setShowSpells] = useSetting<boolean>({
    key: 'timeline-show-spells',
    defaultValue: true,
  });
  const [expanded, setExpanded] = useSetting<boolean>({
    key: 'timeline-expanded',
    defaultValue: false,
  });

  useEffect(() => {
    if (cardRef.current === null) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCardWidth(entry.contentRect.width - 10);
      }
    });

    observer.observe(cardRef.current);
    return () => observer.disconnect();
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
      {
        label: 'timeline-expanded',
        customAction: () => false,
        customElement: (
          <Checkbox
            className={styles.settingsCheckbox}
            label="Show expanded timeline"
            checked={expanded}
            onChange={(checked) => setExpanded(checked)}
            simple
          />
        ),
      },
    ],
    [showSpells, showKits, expanded, setShowSpells, setShowKits, setExpanded],
  );

  let cellSize = props.cellSize;
  if (display.isCompact()) {
    cellSize = 24;
  }

  // Calculate modal width when modal is open.
  const modalWidth = showFullTimeline
    ? Math.floor(window.innerWidth * 0.98)
    : 0;

  let fullTimeline = null;
  if (showFullTimeline) {
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
          showSpells={showSpells}
          wrapWidth={timelineWidth}
          cellSize={display.isFull() ? 28 : 22}
        />
      </div>
    );
  }

  // Calculate inline wrapWidth when expanded mode is enabled.
  const inlineWrapWidth = expanded && cardWidth > 0 ? cardWidth : undefined;

  const settingsMenuWidth = 240;

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
              <span>Full Screen</span>
            </button>
            <button
              ref={settingsButtonRef}
              id="timeline-settings-button"
              onClick={openSettings}
            >
              <i className="fas fa-cog" />
              <span>Settings</span>
            </button>
          </div>
        ),
        styles: { marginBottom: 0 },
      }}
    >
      <div ref={cardRef}>
        <AttackTimeline
          {...props}
          cellSize={cellSize}
          normalizeItems={!showKits}
          showSpells={showSpells}
          wrapWidth={inlineWrapWidth}
        />
      </div>
      <Modal
        className={styles.fullScreenModal}
        header="Room Timeline"
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
