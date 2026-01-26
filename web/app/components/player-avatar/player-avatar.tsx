import styles from './player-avatar.module.scss';

const AVATAR_COLORS = [
  { bg: 'rgba(var(--blert-purple-base), 0.2)', fg: 'var(--blert-purple)' },
  { bg: 'rgba(var(--blert-green-base), 0.2)', fg: 'var(--blert-green)' },
  { bg: 'rgba(var(--blert-blue-base), 0.2)', fg: 'var(--blert-blue)' },
  { bg: 'rgba(249, 115, 22, 0.2)', fg: 'rgb(249, 115, 22)' }, // orange
  { bg: 'rgba(236, 72, 153, 0.2)', fg: 'rgb(236, 72, 153)' }, // pink
  { bg: 'rgba(20, 184, 166, 0.2)', fg: 'rgb(20, 184, 166)' }, // teal
  { bg: 'rgba(var(--blert-yellow-base), 0.2)', fg: 'var(--blert-yellow)' },
  { bg: 'rgba(139, 92, 246, 0.2)', fg: 'rgb(139, 92, 246)' }, // violet
];

export function getAvatarColor(id: number) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

type PlayerAvatarProps = {
  id: number;
  username: string;
  size?: 'small' | 'medium' | 'large';
  className?: string;
};

export default function PlayerAvatar({
  id,
  username,
  size = 'medium',
  className,
}: PlayerAvatarProps) {
  const color = getAvatarColor(id);

  return (
    <span
      className={`${styles.avatar} ${styles[size]} ${className ?? ''}`}
      style={{ background: color.bg, color: color.fg }}
    >
      {username.charAt(0).toUpperCase()}
    </span>
  );
}
