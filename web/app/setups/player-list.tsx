'use client';

import { useContext, useEffect, useState } from 'react';

import Carousel from '@/components/carousel';
import { DisplayContext } from '@/display';

import { Player } from './player';
import { GearSetupPlayer } from './setup';
import { SetupViewingContext } from './viewing-context';

import styles from './style.module.scss';

const PLAYER_WIDTH = 200;
const PLAYER_GAP = 10;

type PlayerListProps = {
  className?: string;
  players: GearSetupPlayer[];
  onAddPlayer?: () => void;
  showAddButton?: boolean;
};

export default function PlayerList({
  className,
  players,
  onAddPlayer,
  showAddButton = false,
}: PlayerListProps) {
  const display = useContext(DisplayContext);
  const { highlightedPlayerIndex } = useContext(SetupViewingContext);

  const [currentIndex, setCurrentIndex] = useState(highlightedPlayerIndex ?? 0);

  const renderCarousel = display.isCompact();

  useEffect(() => {
    if (!renderCarousel) {
      return;
    }

    if (currentIndex >= players.length) {
      setCurrentIndex(players.length - 1);
    }
  }, [players.length, currentIndex, renderCarousel]);

  const addPlayerButton = (
    <div className={styles.addPlayer}>
      <button onClick={onAddPlayer}>
        <i className="fas fa-plus" />
        <span>{renderCarousel ? 'Add player' : 'Add'}</span>
      </button>
    </div>
  );

  const classes = [styles.panel, styles.players];
  if (className) {
    classes.push(className);
  }

  if (renderCarousel) {
    return (
      <div className={classes.join(' ')}>
        <Carousel
          itemWidth={PLAYER_WIDTH}
          currentIndex={currentIndex}
          onIndexChange={setCurrentIndex}
          footer={showAddButton ? addPlayerButton : undefined}
        >
          {players.map((player, index) => (
            <Player key={index} index={index} player={player} />
          ))}
        </Carousel>
      </div>
    );
  }

  return (
    <div className={classes.join(' ')}>
      <div className={styles.wrapper} style={{ width: '100%' }}>
        <div
          className={styles.list}
          style={{
            width: '100%',
            flexWrap: 'wrap',
            gap: PLAYER_GAP,
          }}
        >
          {players.map((player, index) => (
            <Player key={index} index={index} player={player} />
          ))}
          {showAddButton && addPlayerButton}
        </div>
      </div>
    </div>
  );
}
