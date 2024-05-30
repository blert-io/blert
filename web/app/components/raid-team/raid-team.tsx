import { ChallengePlayer, PrimaryMeleeGear } from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';

import styles from './style.module.scss';

type TeamPanelProps = {
  players: ChallengePlayer[];
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
              src={`/images/gear/${PrimaryMeleeGear[player.primaryGear].toLowerCase()}.webp`}
              alt={PrimaryMeleeGear[player.primaryGear].toLowerCase()}
              fill
              style={{ objectFit: 'contain' }}
            />
          </div>
          <div className={styles.raid__PlayerName}>{player.username}</div>
        </>
      );
    } else {
      content = (
        <>
          <div className={styles.raid__PlayerName}>{player.username}</div>
          <Image
            className={styles.raid__PlayerImg}
            src={`/images/gear/${PrimaryMeleeGear[player.primaryGear].toLowerCase()}.webp`}
            alt={PrimaryMeleeGear[player.primaryGear].toLowerCase()}
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
