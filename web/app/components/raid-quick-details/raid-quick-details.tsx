import Image from 'next/image';

import styles from './style.module.scss';
import { ticksToFormattedSeconds } from '../../raid/tick';

const completionToColor = (completion: string) => {
  switch (completion) {
    case 'Completion':
      return '#73AD70';
    case 'Wipe':
      return '#B30000';
    default:
      return '#B9BBB6';
  }
};

const raidDifficultyToColor = (difficulty: string) => {
  switch (difficulty) {
    case 'Normal':
      return '#FFD700';
    case 'Hard':
      return '#D100CC';
    case 'Entry':
      return '#B9BBB6';
    default:
      return '#FFD700';
  }
};

const getRandomBossName = () => {
  const bosses = ['Maiden', 'Bloat', 'Nylo', 'Sote', 'Xarpus'];
  return bosses[Math.floor(Math.random() * bosses.length)];
};

const getRandomBossNameIncludingVerzik = () => {
  const bosses = ['Maiden', 'Bloat', 'Nylo', 'Sote', 'Xarpus', 'Verzik'];
  return bosses[Math.floor(Math.random() * bosses.length)];
};

const randomCompletionOrWipeOrReset = () => {
  const completions = ['Completion', 'Wipe', 'Reset'];
  return completions[Math.floor(Math.random() * completions.length)];
};

const getRandomRaidDifficulty = () => {
  const difficulties = ['Normal', 'Hard', 'Entry'];
  return difficulties[Math.floor(Math.random() * difficulties.length)];
};

export function RaidQuickDetails() {
  const randomRaidDifficulty = getRandomRaidDifficulty();
  const randomCompletion = randomCompletionOrWipeOrReset();

  return (
    <div className={styles.raid__bulletpointDetails}>
      <div
        className={styles.raid__bulletpointDetail}
        style={{
          color: raidDifficultyToColor(randomRaidDifficulty),
        }}
      >
        <i
          className="fa-solid fa-trophy"
          style={{ position: 'relative', left: '-3px' }}
        ></i>{' '}
        {randomRaidDifficulty}
      </div>
      <div
        className={styles.raid__bulletpointDetail}
        style={{
          color: completionToColor(randomCompletion),
        }}
      >
        {randomCompletion === 'Completion' ? (
          <i className="fa-solid fa-check" style={{ fontSize: '21px' }}></i>
        ) : randomCompletion === 'Wipe' ? (
          <i className="fa-solid fa-x" style={{ fontSize: '21px' }}></i>
        ) : (
          <i
            className="fa-solid fa-undo"
            style={{
              fontSize: '21px',
              position: 'relative',
              left: '-5px',
            }}
          ></i>
        )}

        {randomCompletion === `Wipe`
          ? `${getRandomBossNameIncludingVerzik()} `
          : randomCompletion === `Reset`
            ? `${getRandomBossName()} `
            : ''}
        {randomCompletion}
      </div>
      <div className={styles.raid__bulletpointDetail}>
        <i
          className="fa-solid fa-hourglass"
          style={{ position: 'relative', left: '4px' }}
        ></i>
        {ticksToFormattedSeconds(Math.floor(Math.random() * 2000))}
      </div>
      <div className={styles.raid__bulletpointDetail}>
        <i className="fa-solid fa-skull"></i> 3 Deaths
      </div>
      <div className={styles.raid__bulletpointDetail}>
        <i
          className="fa-solid fa-users"
          style={{ position: 'relative', left: '-2px' }}
        ></i>{' '}
        4 Raiders
      </div>
    </div>
  );
}
