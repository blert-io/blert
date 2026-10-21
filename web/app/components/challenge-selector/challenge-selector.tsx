'use client';

import { challengeName, ChallengeType } from '@blert/common';
import Image from 'next/image';
import { useMemo, useState } from 'react';

import Dropdown, { DROPDOWN_FIELD } from '@/components/dropdown';
import { MenuItem } from '@/components/menu';
import { challengeLogo } from '@/logo';

import styles from './style.module.scss';

function ChallengeOption({ challenge }: { challenge: ChallengeType }) {
  return (
    <span className={styles.option}>
      <span className={styles.logo}>
        <Image
          src={challengeLogo(challenge)}
          alt=""
          fill
          sizes="24px"
          style={{ objectFit: 'contain' }}
        />
      </span>
      {challengeName(challenge)}
    </span>
  );
}

type ChallengeSelectorProps<T extends ChallengeType> = {
  /** The challenges to offer, in menu order. */
  challenges: readonly T[];
  /** ID of the field, for a label's `htmlFor`. */
  id: string;
  onChange: (challenge: T) => void;
  value: T;
};

/**
 * A field that opens a menu of challenges. Fills the width of its container.
 */
export default function ChallengeSelector<T extends ChallengeType>({
  challenges,
  id,
  onChange,
  value,
}: ChallengeSelectorProps<T>) {
  const [open, setOpen] = useState(false);

  const items: MenuItem[] = useMemo(
    () =>
      challenges.map((challenge) => ({
        label: challengeName(challenge),
        value: challenge,
        customElement: <ChallengeOption challenge={challenge} />,
      })),
    [challenges],
  );

  return (
    <Dropdown
      items={items}
      onClose={() => setOpen(false)}
      onSelection={(challenge) => onChange(challenge as T)}
      open={open}
      targetId={id}
    >
      <button
        id={id}
        className={`${styles.selector} ${DROPDOWN_FIELD}`}
        onClick={() => setOpen(!open)}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <ChallengeOption challenge={value} />
        <i className="fas fa-chevron-down" />
      </button>
    </Dropdown>
  );
}
