import { Mode, RaidStatus } from '@blert/common';
import TimeAgo from 'react-timeago';

import { ticksToFormattedSeconds } from '../../utils/tick';

import styles from './style.module.scss';

const completionToColor = (raidStatus: RaidStatus) => {
  switch (raidStatus) {
    case RaidStatus.COMPLETED:
      return '#73AD70';
    case RaidStatus.MAIDEN_WIPE:
    case RaidStatus.BLOAT_WIPE:
    case RaidStatus.NYLO_WIPE:
    case RaidStatus.SOTE_WIPE:
    case RaidStatus.XARPUS_WIPE:
    case RaidStatus.VERZIK_WIPE:
      return '#B30000';
    case RaidStatus.MAIDEN_RESET:
    case RaidStatus.BLOAT_RESET:
    case RaidStatus.NYLO_RESET:
    case RaidStatus.SOTE_RESET:
    case RaidStatus.XARPUS_RESET:
      return '#B9BBB6';
    default:
      return '#FFFFFF';
  }
};

const raidDifficultyToColor = (difficulty: Mode | undefined) => {
  switch (difficulty) {
    case Mode.REGULAR:
      return '#FFD700';
    case Mode.HARD:
      return '#D100CC';
    case Mode.ENTRY:
      return '#B9BBB6';
    default:
      return '#FFD700';
  }
};

const raidStatusToFriendlyRaidStatus = (status: RaidStatus) => {
  if (status === RaidStatus.COMPLETED) {
    return 'Completed';
  }

  const split = status.split('_');
  const boss = split[0].charAt(0) + split[0].slice(1).toLowerCase();
  const action = split[1].charAt(0) + split[1].slice(1).toLowerCase();
  return `${boss} ${action}`;
};

const getIconForStatus = (status: RaidStatus) => {
  switch (status) {
    case RaidStatus.COMPLETED:
      return <i className="fa-solid fa-check" style={{ fontSize: '21px' }}></i>;
    case RaidStatus.MAIDEN_WIPE:
    case RaidStatus.BLOAT_WIPE:
    case RaidStatus.NYLO_WIPE:
    case RaidStatus.SOTE_WIPE:
    case RaidStatus.XARPUS_WIPE:
    case RaidStatus.VERZIK_WIPE:
      return <i className="fa-solid fa-x" style={{ fontSize: '21px' }}></i>;
    case RaidStatus.MAIDEN_RESET:
    case RaidStatus.BLOAT_RESET:
    case RaidStatus.NYLO_RESET:
    case RaidStatus.SOTE_RESET:
    case RaidStatus.XARPUS_RESET:
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
  raidStatus: RaidStatus;
  raidDifficulty: Mode | undefined;
  totalRaidTicks: number;
  deaths: number;
  partySize: number;
  startTime: Date;
}

export function RaidQuickDetails(props: RaidQuickDetailsProps) {
  const {
    raidStatus,
    raidDifficulty,
    totalRaidTicks,
    deaths,
    partySize,
    startTime,
  } = props;

  const statusString = raidStatusToFriendlyRaidStatus(raidStatus);

  const modeString =
    raidDifficulty !== undefined
      ? raidDifficulty.charAt(0) + raidDifficulty.slice(1).toLowerCase()
      : 'Unknown';

  const iconForStatus = getIconForStatus(raidStatus);

  const ticks = ticksToFormattedSeconds(totalRaidTicks);

  return (
    <div className={styles.raid__bulletpointDetails}>
      <div
        className={styles.raid__bulletpointDetail}
        style={{
          color: raidDifficultyToColor(raidDifficulty),
        }}
      >
        <i
          className="fa-solid fa-trophy"
          style={{ position: 'relative', left: '-3px' }}
        ></i>{' '}
        {modeString}
      </div>
      <div
        className={styles.raid__bulletpointDetail}
        style={{
          color: completionToColor(raidStatus),
        }}
      >
        {iconForStatus}

        {statusString}
      </div>
      <div className={styles.raid__bulletpointDetail}>
        <i
          className="fa-solid fa-hourglass"
          style={{ position: 'relative', left: '4px' }}
        ></i>
        {ticks}
      </div>
      <div className={styles.raid__bulletpointDetail}>
        <i className="fa-solid fa-skull"></i> {deaths} Deaths
      </div>
      <div className={styles.raid__bulletpointDetail}>
        <i
          className="fa-solid fa-users"
          style={{ position: 'relative', left: '-2px' }}
        ></i>{' '}
        {partySize} Raiders
      </div>
      <div
        className={styles.raid__bulletpointDetail}
        style={{ marginRight: '25px', minWidth: '160px' }}
      >
        <i className="fa-solid fa-clock"></i> <TimeAgo date={startTime} />
      </div>
    </div>
  );
}
