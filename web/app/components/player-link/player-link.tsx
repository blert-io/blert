import Link from 'next/link';

import { playerUrl } from '@/utils/url';

import styles from './style.module.scss';

export const PLAYER_LINK_TOOLTIP_ID = 'player-link-tooltip';

type PlayerLinkProps = {
  username: string;
  className?: string;
  children?: React.ReactNode;
};

export function PlayerLink({ username, className, children }: PlayerLinkProps) {
  return (
    <Link
      href={playerUrl(username)}
      className={className}
      data-tooltip-id={PLAYER_LINK_TOOLTIP_ID}
      data-tooltip-username={username}
    >
      {children ?? <span className={styles.playerLink}>{username}</span>}
    </Link>
  );
}

type PlayerTooltipWrapperProps = {
  username: string;
  className?: string;
  children: React.ReactNode;
};

export function PlayerTooltipWrapper({
  username,
  className,
  children,
}: PlayerTooltipWrapperProps) {
  return (
    <span
      className={className}
      data-tooltip-id={PLAYER_LINK_TOOLTIP_ID}
      data-tooltip-username={username}
    >
      {children}
    </span>
  );
}
