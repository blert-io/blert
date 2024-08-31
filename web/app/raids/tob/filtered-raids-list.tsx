'use client';

import { ChallengeMode, ChallengeType, ChallengeStatus } from '@blert/common';
import { useState } from 'react';

import { ClientChallengeHistory } from '@/components/challenge-history';
import Checkbox from '@/components/checkbox';
import RadioInput from '@/components/radio-input';

import styles from './style.module.scss';

export default function FilteredRaidsList() {
  const [scale, setScale] = useState<number | undefined>(undefined);
  const [mode, setMode] = useState<ChallengeMode | undefined>(undefined);
  const [statuses, setStatuses] = useState<number[]>([
    ChallengeStatus.IN_PROGRESS,
    ChallengeStatus.COMPLETED,
    ChallengeStatus.WIPED,
    ChallengeStatus.RESET,
  ]);

  const toggleStatus = (status: ChallengeStatus) => {
    if (statuses.includes(status)) {
      setStatuses(statuses.filter((s) => s !== status));
    } else {
      setStatuses([...statuses, status]);
    }
  };

  return (
    <div className={styles.raidsList}>
      <div className={styles.raidFilters}>
        <div className={styles.filter}>
          <div className={styles.label}>Scale</div>
          <RadioInput.Group
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
            <RadioInput.Option
              checked={scale === 1}
              id="scale-1"
              label="Solo"
              value={1}
            />
            <RadioInput.Option
              checked={scale === 2}
              id="scale-2"
              label="Duo"
              value={2}
            />
            <RadioInput.Option
              checked={scale === 3}
              id="scale-3"
              label="Trio"
              value={3}
            />
            <RadioInput.Option
              checked={scale === 4}
              id="scale-4"
              label="4s"
              value={4}
            />
            <RadioInput.Option
              checked={scale === 5}
              id="scale-5"
              label="5s"
              value={5}
            />
          </RadioInput.Group>
        </div>
        <div className={styles.filter}>
          <div className={styles.label}>Mode</div>
          <RadioInput.Group
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
      </div>
      <div className={styles.raidFilters}>
        <div className={styles.statuses}>
          <Checkbox
            className={styles.checkbox}
            checked={statuses.includes(ChallengeStatus.IN_PROGRESS)}
            onChange={() => toggleStatus(ChallengeStatus.IN_PROGRESS)}
            label="In Progress"
          />
          <Checkbox
            className={styles.checkbox}
            checked={statuses.includes(ChallengeStatus.COMPLETED)}
            onChange={() => toggleStatus(ChallengeStatus.COMPLETED)}
            label="Completion"
          />
          <Checkbox
            className={styles.checkbox}
            checked={statuses.includes(ChallengeStatus.WIPED)}
            onChange={() => toggleStatus(ChallengeStatus.WIPED)}
            label="Wipe"
          />
          <Checkbox
            className={styles.checkbox}
            checked={statuses.includes(ChallengeStatus.RESET)}
            onChange={() => toggleStatus(ChallengeStatus.RESET)}
            label="Reset"
          />
        </div>
      </div>
      <div className={styles.divider} />
      <ClientChallengeHistory
        type={ChallengeType.TOB}
        initialChallenges={[]}
        count={10}
        mode={mode}
        scale={scale}
        status={statuses}
      />
    </div>
  );
}
