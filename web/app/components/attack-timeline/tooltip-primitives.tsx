'use client';

import React from 'react';

import { HintImage } from './hint-image';

import styles from './tooltip-primitives.module.scss';

type TooltipContainerProps = {
  children: React.ReactNode;
};

export function TooltipContainer({ children }: TooltipContainerProps) {
  return <div className={styles.tooltip}>{children}</div>;
}

type TooltipHeaderProps = {
  name: React.ReactNode;
  tick: number;
  time?: string;
};

export function TooltipHeader({ name, tick, time }: TooltipHeaderProps) {
  return (
    <div className={styles.tooltipHeader}>
      <span className={styles.actorName}>{name}</span>
      <span className={styles.tickInfo}>Tick {tick}</span>
      {time && <span className={styles.timeInfo}>{time}</span>}
    </div>
  );
}

type TooltipSectionProps = {
  icon: string;
  title: string;
  children: React.ReactNode;
};

export function TooltipSection({ icon, title, children }: TooltipSectionProps) {
  return (
    <div className={styles.tooltipSection}>
      <div className={styles.sectionHeader}>
        <i className={icon} />
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

export function TooltipDivider() {
  return <div className={styles.sectionDivider} />;
}

type TooltipNoContentProps = {
  message?: string;
};

export function TooltipNoContent({
  message = 'Nothing interesting happened.',
}: TooltipNoContentProps) {
  return (
    <div className={`${styles.tooltipSection} ${styles.noContent}`}>
      {message}
    </div>
  );
}

type PlayerChipProps = {
  name: string;
  onClick?: () => void;
};

export function PlayerChip({ name, onClick }: PlayerChipProps) {
  const className = `${styles.chip} ${styles.player}`;

  if (onClick) {
    return (
      <button className={className} onClick={onClick}>
        <i className="fas fa-user" />
        {name}
      </button>
    );
  }

  return (
    <span className={className}>
      <i className="fas fa-user" />
      {name}
    </span>
  );
}

type NpcChipProps = {
  name: string;
  imageUrl?: string;
};

export function NpcChip({ name, imageUrl }: NpcChipProps) {
  return (
    <span className={`${styles.chip} ${styles.npc}`}>
      {imageUrl && <HintImage src={imageUrl} alt={name} size={14} />}
      {name}
    </span>
  );
}

type SpellChipProps = {
  name: string;
  imageUrl: string;
};

export function SpellChip({ name, imageUrl }: SpellChipProps) {
  return (
    <span className={`${styles.chip} ${styles.spell}`}>
      <HintImage src={imageUrl} alt={name} size={14} />
      {name}
    </span>
  );
}

type AttackInfoProps = {
  verb?: string;
  target?: React.ReactNode;
  distance?: number;
};

export function AttackInfo({ verb, target, distance }: AttackInfoProps) {
  return (
    <div className={styles.attackInfo}>
      {verb && <span className={styles.attackVerb}>{verb}</span>}
      {target}
      {distance !== undefined && (
        <span className={styles.distanceInfo}>
          from {distance} tile{distance === 1 ? '' : 's'} away
        </span>
      )}
    </div>
  );
}

type SpellInfoProps = {
  children: React.ReactNode;
};

export function SpellInfo({ children }: SpellInfoProps) {
  return <div className={styles.spellInfo}>{children}</div>;
}

type DeathInfoProps = {
  diedThisTick: boolean;
};

export function DeathInfo({ diedThisTick }: DeathInfoProps) {
  return (
    <div className={styles.deathInfo}>
      {diedThisTick ? 'Died this tick' : 'Dead'}
    </div>
  );
}

type CustomStateItemProps = {
  label: string;
  iconUrl?: string;
};

export function CustomStateItem({ label, iconUrl }: CustomStateItemProps) {
  return (
    <div className={styles.customStateItem}>
      <div className={styles.customStateIcon}>
        {iconUrl ? (
          <HintImage src={iconUrl} alt={label} size={16} />
        ) : (
          <i className="fas fa-star" />
        )}
      </div>
      <span className={styles.customStateLabel}>{label}</span>
    </div>
  );
}

type CustomStateListProps = {
  children: React.ReactNode;
};

export function CustomStateList({ children }: CustomStateListProps) {
  return <div className={styles.customStateList}>{children}</div>;
}
