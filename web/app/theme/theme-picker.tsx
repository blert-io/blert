'use client';

import { useRef, useState } from 'react';

import Modal from '@/components/modal';
import { trackEvent } from '@/utils/analytics';
import { useSetting } from '@/utils/user-settings';

import {
  DEFAULT_THEME,
  resolveThemeId,
  THEME_SETTING_KEY,
  THEMES,
  ThemeId,
} from './themes';

import styles from './theme-picker.module.scss';

export default function ThemePicker({
  variant = 'chip',
}: {
  variant?: 'chip' | 'mini';
}) {
  const [theme, setTheme] = useSetting<ThemeId>({
    key: THEME_SETTING_KEY,
    defaultValue: DEFAULT_THEME,
  });
  const [open, setOpen] = useState(false);
  const current = resolveThemeId(theme);

  // Selecting a card applies its theme immediately, so clicks are previews as
  // much as they are choices. Only the theme in effect when the picker closes
  // is reported as a change.
  const themeAtOpen = useRef<ThemeId>(current);

  const handleOpen = () => {
    themeAtOpen.current = current;
    trackEvent('theme_picker_opened', { theme: current, variant });
    setOpen(true);
  };

  const handleClose = () => {
    if (current !== themeAtOpen.current) {
      trackEvent('theme_changed', { from: themeAtOpen.current, to: current });
      // Immediately update to avoid double reporting if close fires again.
      themeAtOpen.current = current;
    }
    setOpen(false);
  };

  return (
    <>
      <button
        className={variant === 'mini' ? styles.mini : styles.chip}
        onClick={handleOpen}
        aria-label="Change theme"
      >
        <span className={`${styles.chipSwatch} ${styles.chipSwatchBg}`} />
        <span className={`${styles.chipSwatch} ${styles.chipSwatchAccent}`} />
        <span className={`${styles.chipSwatch} ${styles.chipSwatchFg}`} />
        {variant !== 'mini' && <span className={styles.chipLabel}>Theme</span>}
      </button>

      <Modal
        open={open}
        onClose={handleClose}
        header="Theme"
        width="min(600px, 92vw)"
      >
        <div className={styles.grid}>
          {THEMES.map((definition) => {
            const selected = current === definition.id;
            return (
              <button
                key={definition.id}
                className={`${styles.card} ${selected ? styles.cardActive : ''}`}
                onClick={() => setTheme(definition.id)}
              >
                <div className={styles.preview} data-theme={definition.id}>
                  <div className={styles.previewTopbar}>
                    <span className={styles.barAccent} />
                    <span className={styles.barTopSec} />
                    <span className={styles.barTopSec} />
                  </div>
                  <div className={styles.previewBody}>
                    <div
                      className={`${styles.previewPanel} ${styles.previewPanelLeft}`}
                    >
                      <span className={styles.barPrimary} />
                      <span
                        className={`${styles.barSec} ${styles.barSecWide}`}
                      />
                      <span
                        className={`${styles.barSec} ${styles.barSecMed}`}
                      />
                    </div>
                    <div
                      className={`${styles.previewPanel} ${styles.previewPanelRight}`}
                    >
                      <span
                        className={`${styles.block} ${styles.blockAccent}`}
                      />
                      <span
                        className={`${styles.block} ${styles.blockLight}`}
                      />
                    </div>
                  </div>
                </div>
                <div className={styles.cardFooter}>
                  <div className={styles.cardText}>
                    <span className={styles.cardName}>{definition.label}</span>
                  </div>
                  <div className={styles.cardMeta}>
                    <div className={styles.swatches} data-theme={definition.id}>
                      <span
                        className={`${styles.swatch} ${styles.swatchPage}`}
                      />
                      <span
                        className={`${styles.swatch} ${styles.swatchPanel}`}
                      />
                      <span
                        className={`${styles.swatch} ${styles.swatchLight}`}
                      />
                      <span
                        className={`${styles.swatch} ${styles.swatchAccent}`}
                      />
                      <span
                        className={`${styles.swatch} ${styles.swatchPrimary}`}
                      />
                    </div>
                    {selected ? (
                      <i
                        className={`fa-solid fa-circle-check ${styles.check}`}
                      />
                    ) : (
                      <span className={styles.idleDot} />
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Modal>
    </>
  );
}
