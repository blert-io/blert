import Image from 'next/image';

import styles from './style.module.scss';

export enum PrimaryMeleeGear {
  EliteVoid,
  Bandos,
  Torva,
  Blorva,
}

interface TeamPanelPlayer {
  name: string;
  primaryMeleeGear: PrimaryMeleeGear;
}

type TeamPanelProps = {
  players: TeamPanelPlayer[];
};

export function RaidTeamPanel(props: TeamPanelProps) {
  const { players } = props;

  const playerElements = players.map((player, index) => {
    return (
      <div key={`raid-player-panel-${index}`} className={styles.raid__Player}>
        <div className={styles.raid__PlayerName}>{player.name}</div>
        <Image
          className={styles.raid__PlayerImg}
          src={`/${PrimaryMeleeGear[player.primaryMeleeGear].toLowerCase()}.webp`}
          alt={PrimaryMeleeGear[player.primaryMeleeGear].toLowerCase()}
          height={110}
          width={70}
        />
      </div>
    );
  });

  return <div className={styles.raid__Team}>{playerElements}</div>;
}
