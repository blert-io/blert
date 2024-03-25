import { ChallengeMode, ChallengeStatus, Stage } from '@blert/common';
import TimeAgo from 'react-timeago';

import { ticksToFormattedSeconds } from '../../utils/tick';

import styles from './style.module.scss';

const raidDifficultyNameAndColor = (difficulty: ChallengeMode) => {
  switch (difficulty) {
    case ChallengeMode.TOB_REGULAR:
      return ['Regular', '#FFD700'];
    case ChallengeMode.TOB_HARD:
      return ['Hard', '#D100CC'];
    case ChallengeMode.TOB_ENTRY:
      return ['Entry', '#B9BBB6'];
    default:
      return ['Unknown', '#FFD700'];
  }
};

export const raidStatusNameAndColor = (
  status: ChallengeStatus,
  stage: Stage,
) => {
  if (status === ChallengeStatus.IN_PROGRESS) {
    return ['In Progress', '#FFFFFF'];
  }
  if (status === ChallengeStatus.COMPLETED) {
    return ['Completion', '#73AD70'];
  }

  let boss = 'Unknown';

  switch (stage) {
    case Stage.TOB_MAIDEN:
      boss = 'Maiden';
      break;
    case Stage.TOB_BLOAT:
      boss = 'Bloat';
      break;
    case Stage.TOB_NYLOCAS:
      boss = 'Nylocas';
      break;
    case Stage.TOB_SOTETSEG:
      boss = 'Sotetseg';
      break;
    case Stage.TOB_XARPUS:
      boss = 'Xarpus';
      break;
    case Stage.TOB_VERZIK:
      boss = 'Verzik';
      break;
  }

  if (status === ChallengeStatus.RESET) {
    return [`${boss} Reset`, '#B9BBB6'];
  }
  return [`${boss} Wipe`, '#B30000'];
};

const getIconForStatus = (status: ChallengeStatus) => {
  switch (status) {
    case ChallengeStatus.COMPLETED:
      return <i className="fa-solid fa-check" style={{ fontSize: '21px' }}></i>;
    case ChallengeStatus.WIPED:
      return <i className="fa-solid fa-x" style={{ fontSize: '21px' }}></i>;
    case ChallengeStatus.RESET:
      return (
        <i
          className="fa-solid fa-undo"
          style={{
            fontSize: '21px',
            position: 'relative',
            left: '-5px',
          }}
        ></i>
      );
    default:
      return <i className="fa-solid fa-x" style={{ fontSize: '21px' }}></i>;
  }
};

interface RaidQuickDetailsProps {
  stage: Stage;
  raidStatus: ChallengeStatus;
  raidDifficulty: ChallengeMode;
  totalRaidTicks: number;
  deaths: number;
  partySize: number;
  startTime: Date;
  compactView?: boolean;
}

export function RaidQuickDetails(props: RaidQuickDetailsProps) {
  const {
    stage,
    raidStatus,
    raidDifficulty,
    totalRaidTicks,
    deaths,
    partySize,
    startTime,
    compactView,
  } = props;

  const [statusString, statusColor] = raidStatusNameAndColor(raidStatus, stage);
  const [modeString, modeColor] = raidDifficultyNameAndColor(raidDifficulty);
  const iconForStatus = getIconForStatus(raidStatus);
  const ticks = ticksToFormattedSeconds(totalRaidTicks);

  return (
    <div
      className={`${styles.raid__bulletpointDetails}${compactView ? ' ' + styles.raid__bulletpointDetailsCompact : ''}`}
    >
      <div
        className={styles.raid__bulletpointDetail}
        style={{ color: modeColor }}
      >
        <i
          className="fa-solid fa-trophy"
          style={{ position: 'relative', left: '-3px' }}
        ></i>{' '}
        {modeString}
      </div>
      <div
        className={styles.raid__bulletpointDetail}
        style={{ color: statusColor }}
      >
        {iconForStatus}

        {statusString}
      </div>
      <div className={styles.raid__bulletpointDetail}>
        <i
          className="fa-solid fa-users"
          style={{ position: 'relative', left: '-2px' }}
        ></i>{' '}
        {partySize} Raiders
      </div>
      <div className={styles.raid__bulletpointDetail}>
        <i
          className="fa-solid fa-hourglass"
          style={{ position: 'relative', left: '4px' }}
        ></i>
        {ticks}
      </div>
      <div className={styles.raid__bulletpointDetail}>
        <i className="fa-solid fa-skull"></i> {deaths} Death
        {deaths !== 1 && 's'}
      </div>
      <div className={styles.raid__bulletpointDetail}>
        <i className="fa-solid fa-clock"></i> <TimeAgo date={startTime} />
      </div>
    </div>
  );
}
