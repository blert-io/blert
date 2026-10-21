'use client';

import { ChallengeMode, ChallengeType } from '@blert/common';
import { useState } from 'react';

import Card from '@/components/card';
import RadioInput from '@/components/radio-input';
import { ClientSessionHistory } from '@/components/session-history';
import { scaleNameAndColor } from '@/utils/challenge';

import styles from './filtered-session-list.module.scss';

export default function FilteredSessionList({ type }: { type: ChallengeType }) {
  const [scale, setScale] = useState<number | undefined>(undefined);
  const [mode, setMode] = useState<ChallengeMode | undefined>(undefined);

  const isSolo =
    type === ChallengeType.COLOSSEUM ||
    type === ChallengeType.INFERNO ||
    type === ChallengeType.MOKHAIOTL;
  const hasMode = type === ChallengeType.TOB;
  const maxScale = type === ChallengeType.TFA ? 8 : 5;

  return (
    <Card
      className={styles.sessionList}
      header={{ title: <span className={styles.title}>Recent Sessions</span> }}
    >
      <div className={styles.filters}>
        {!isSolo && (
          <div className={styles.filter}>
            <div className={styles.label}>Scale</div>
            <RadioInput.Group
              compact
              joined
              name="scale"
              onChange={(value) => {
                if (value === 0) {
                  setScale(undefined);
                } else {
                  setScale(value as number);
                }
              }}
            >
              <RadioInput.Option
                checked={scale === undefined}
                id="scale-any"
                label="Any"
                value={0}
              />
              {Array.from({ length: maxScale }, (_, i) => i + 1).map((s) => (
                <RadioInput.Option
                  key={s}
                  checked={scale === s}
                  id={`scale-${s}`}
                  label={scaleNameAndColor(s)[0]}
                  value={s}
                />
              ))}
            </RadioInput.Group>
          </div>
        )}
        {hasMode && (
          <div className={styles.filter}>
            <div className={styles.label}>Mode</div>
            <RadioInput.Group
              compact
              joined
              name="mode"
              onChange={(value) => {
                if (value === ChallengeMode.NO_MODE) {
                  setMode(undefined);
                } else {
                  setMode(value as ChallengeMode);
                }
              }}
            >
              <RadioInput.Option
                checked={mode === undefined}
                id="mode-any"
                label="Any"
                value={ChallengeMode.NO_MODE}
              />
              <RadioInput.Option
                checked={mode === ChallengeMode.TOB_REGULAR}
                id="mode-regular"
                label="Regular"
                value={ChallengeMode.TOB_REGULAR}
              />
              <RadioInput.Option
                checked={mode === ChallengeMode.TOB_HARD}
                id="mode-hard"
                label="Hard"
                value={ChallengeMode.TOB_HARD}
              />
            </RadioInput.Group>
          </div>
        )}
      </div>
      <ClientSessionHistory
        type={type}
        initialSessions={[]}
        count={10}
        mode={mode}
        scale={scale}
      />
    </Card>
  );
}
