import { PrimaryMeleeGear } from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';

import styles from './style.module.scss';

interface TeamPanelPlayer {
  name: string;
  currentUsername: string;
  primaryMeleeGear: PrimaryMeleeGear;
}

type TeamPanelProps = {
  players: TeamPanelPlayer[];
  compactView?: boolean;
};

export function RaidTeamPanel(props: TeamPanelProps) {
  const { players, compactView } = props;

  const playerElements = players.map((player, index) => {
    let content;
    if (compactView) {
      content = (
        <>
          <div className={styles.imageWrapper}>
            <Image
              className={styles.raid__PlayerImg}
              src={`/${PrimaryMeleeGear[player.primaryMeleeGear].toLowerCase()}.webp`}
              alt={PrimaryMeleeGear[player.primaryMeleeGear].toLowerCase()}
              fill
              style={{ objectFit: 'contain' }}
            />
          </div>
          <div className={styles.raid__PlayerName}>{player.name}</div>
        </>
      );
    } else {
      content = (
        <>
          <div className={styles.raid__PlayerName}>{player.name}</div>
          <Image
            className={styles.raid__PlayerImg}
            src={`/${PrimaryMeleeGear[player.primaryMeleeGear].toLowerCase()}.webp`}
            alt={PrimaryMeleeGear[player.primaryMeleeGear].toLowerCase()}
            fill
            style={{ objectFit: 'contain' }}
          />
        </>
      );
    }

    return (
      <Link
        href={`/players/${player.currentUsername}`}
        key={`raid-player-panel-${index}`}
        className={styles.raid__Player}
        style={{ position: 'relative' }}
      >
        {content}
      </Link>
    );
  });

  return (
    <div
      className={`${styles.raid__Team}${compactView ? ' ' + styles.raid__TeamCompactView : ''}`}
    >
      {playerElements}
    </div>
  );
}
