'use client';

import { useContext, useEffect, useState } from 'react';

import Card from '@/components/card';
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
  maxPlayersPerRow?: number;
};

export default function PlayerList({
  className,
  players,
  onAddPlayer,
  showAddButton = false,
  maxPlayersPerRow = 4,
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

  const classes = [styles.players];
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

  const playersPerRow =
    Math.min(players.length, maxPlayersPerRow) + (showAddButton ? 1 : 0);
  const playerWidth = PLAYER_WIDTH;
  const totalGap = (playersPerRow - 1) * PLAYER_GAP;
  const minContainerWidth = playersPerRow * playerWidth + totalGap;

  return (
    <Card className={classes.join(' ')}>
      <div className={styles.wrapper} style={{ width: '100%' }}>
        <div
          className={styles.list}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fit, minmax(${playerWidth}px, 1fr))`,
            gap: PLAYER_GAP,
            justifyContent: 'center',
            maxWidth: `${minContainerWidth}px`,
            margin: '0 auto',
          }}
        >
          {players.map((player, index) => (
            <Player key={index} index={index} player={player} />
          ))}
          {showAddButton && addPlayerButton}
        </div>
      </div>
    </Card>
  );
}
