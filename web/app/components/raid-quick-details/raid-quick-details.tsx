'use client';

import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  Stage,
} from '@blert/common';
import TimeAgo from 'react-timeago';

import { ticksToFormattedSeconds } from '../../utils/tick';

import { raidStatusNameAndColor } from './status';

import styles from './style.module.scss';

const modeNameAndColor = (type: ChallengeType, difficulty: ChallengeMode) => {
  if (type === ChallengeType.COLOSSEUM) {
    return ['Colosseum', '#33a4af'];
  }
  if (type === ChallengeType.INFERNO) {
    return ['Inferno', '#a14f1a'];
  }

  switch (difficulty) {
    case ChallengeMode.TOB_REGULAR:
      return ['ToB Regular', '#ffd700'];
    case ChallengeMode.TOB_HARD:
      return ['ToB Hard', '#d100cc'];
    case ChallengeMode.TOB_ENTRY:
      return ['ToB Entry', '#b9bbb6'];
    default:
      return ['Unknown', '#ffd700'];
  }
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
  type: ChallengeType;
  stage: Stage;
  status: ChallengeStatus;
  mode: ChallengeMode;
  totalRaidTicks: number;
  deaths: number;
  partySize: number;
  startTime: Date;
  compactView?: boolean;
}

export function RaidQuickDetails(props: RaidQuickDetailsProps) {
  const {
    type,
    stage,
    status,
    mode,
    totalRaidTicks,
    deaths,
    partySize,
    startTime,
    compactView,
  } = props;

  const [statusString, statusColor] = raidStatusNameAndColor(status, stage);
  const [modeString, modeColor] = modeNameAndColor(type, mode);
  const iconForStatus = getIconForStatus(status);
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
        {partySize} Raider{partySize !== 1 && 's'}
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
