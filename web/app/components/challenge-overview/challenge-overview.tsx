'use client';

import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  Stage,
  ChallengePlayer,
  PrimaryMeleeGear,
  stageName,
} from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';
import TimeAgo from 'react-timeago';

import PvMContentLogo, { PvMContent } from '@/components/pvm-content-logo';
import {
  modeNameAndColor,
  statusNameAndColor,
} from '@/components/raid-quick-details/status';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import { useClientOnly } from '@/hooks/client-only';
import { ticksToFormattedSeconds } from '@/utils/tick';

import styles from './style.module.scss';

type ExtendedChallengePlayer = ChallengePlayer & {
  stageDeaths: Stage[];
};

interface ChallengeOverviewProps {
  type: ChallengeType;
  stage: Stage;
  status: ChallengeStatus;
  mode: ChallengeMode;
  challengeTicks: number;
  deaths: number;
  party: ExtendedChallengePlayer[];
  startTime: Date;
  pvmContent: PvMContent;
  extraInfo?: Array<{
    label: string;
    value: string | number | React.ReactNode;
    icon?: string;
    span?: number;
  }>;
}

interface PlayerCardProps {
  player: ExtendedChallengePlayer;
  role?: string;
}

function PlayerCard({ player, role }: PlayerCardProps) {
  let deathTooltipContent = '';
  if (player.stageDeaths.length > 0) {
    deathTooltipContent = `Died at ${player.stageDeaths.map(stageName).join(', ')}`;
  }

  return (
    <Link href={`/players/${player.currentUsername}`} className={styles.player}>
      <div className={styles.imageWrapper}>
        <Image
          className={styles.playerImg}
          src={`/images/gear/${PrimaryMeleeGear[player.primaryGear].toLowerCase()}.webp`}
          alt={PrimaryMeleeGear[player.primaryGear].toLowerCase()}
          fill
          style={{ objectFit: 'contain', top: '22px' }}
        />
      </div>
      <div className={styles.playerInfo}>
        <div className={styles.playerName}>{player.username}</div>
        {role && <div className={styles.playerRole}>{role}</div>}
      </div>
      {player.stageDeaths.length > 0 && (
        <div
          className={styles.deathCount}
          data-tooltip-id={GLOBAL_TOOLTIP_ID}
          data-tooltip-content={deathTooltipContent}
        >
          <i className="fa-solid fa-skull" />
          <span>×{player.stageDeaths.length}</span>
        </div>
      )}
    </Link>
  );
}

const getIconForStatus = (status: ChallengeStatus, color: string) => {
  switch (status) {
    case ChallengeStatus.COMPLETED:
      return <i className="fa-solid fa-check" style={{ color }} />;
    case ChallengeStatus.WIPED:
      return <i className="fa-solid fa-x" style={{ color }} />;
    case ChallengeStatus.RESET:
      return <i className="fa-solid fa-undo" style={{ color }} />;
    case ChallengeStatus.IN_PROGRESS:
      return <i className="fa-solid fa-ellipsis" style={{ color }} />;
    default:
      return <i className="fa-solid fa-x" style={{ color }} />;
  }
};

export function ChallengeOverview(props: ChallengeOverviewProps) {
  const {
    type,
    stage,
    status,
    mode,
    challengeTicks,
    deaths,
    party,
    startTime,
    pvmContent,
    extraInfo,
  } = props;

  const isClient = useClientOnly();
  const [statusString, statusColor] = statusNameAndColor(status, stage);
  const [modeString] = modeNameAndColor(type, mode);
  const iconForStatus = getIconForStatus(status, statusColor);
  const ticks = ticksToFormattedSeconds(challengeTicks);

  const playerElements = party.map((player) => (
    <PlayerCard key={player.currentUsername} player={player} />
  ));

  return (
    <div className={styles.challengeOverview}>
      <div className={styles.logoSection}>
        <PvMContentLogo
          className={styles.logo}
          pvmContent={pvmContent}
          height={80}
          width={152}
          simple
        />
        <div className={styles.modeBadge}>
          <i className="fa-solid fa-trophy" />
          {modeString}
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.quickStats}>
          <div className={styles.statItem} data-label="Status">
            <div className={styles.statLabel}>Status</div>
            <div className={styles.statValue}>
              {iconForStatus}
              <span style={{ color: statusColor }}>{statusString}</span>
            </div>
          </div>
          <div className={styles.statItem} data-label="Team Size">
            <div className={styles.statLabel}>Team Size</div>
            <div className={styles.statValue}>
              <i className="fa-solid fa-users" />
              <span>{party.length}</span>
            </div>
          </div>
          <div className={styles.statItem} data-label="Duration">
            <div className={styles.statLabel}>Duration</div>
            <div className={styles.statValue}>
              <i className="fa-solid fa-hourglass" />
              <span className={styles.time}>{ticks}</span>
            </div>
          </div>
          <div className={styles.statItem} data-label="Deaths">
            <div className={styles.statLabel}>Deaths</div>
            <div className={styles.statValue}>
              <i className="fa-solid fa-skull" />
              <span>{deaths}</span>
            </div>
          </div>
          <div className={styles.statItem} data-label="Started">
            <div className={styles.statLabel}>Started</div>
            <div className={styles.statValue}>
              <i className="fa-solid fa-clock" />
              <span>{isClient && <TimeAgo date={startTime} />}</span>
            </div>
          </div>
          {extraInfo?.map((info) => (
            <div
              key={info.label}
              className={styles.statItem}
              data-label={info.label}
              style={
                info.span ? { gridColumn: `span ${info.span}` } : undefined
              }
            >
              <div className={styles.statLabel}>{info.label}</div>
              <div className={styles.statValue}>
                {info.icon && <i className={info.icon} />}
                <span>{info.value}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.team}>
          <h3>Team Members</h3>
          <div className={styles.players}>{playerElements}</div>
        </div>
      </div>
    </div>
  );
}
