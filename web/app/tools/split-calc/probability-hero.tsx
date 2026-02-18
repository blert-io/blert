import { ticksToFormattedSeconds } from '@/utils/tick';

import styles from './style.module.scss';

type ProbabilityHeroProps = {
  /** Overall probability (0-1), or null if no target is set. */
  probability: number | null;
  /** 90% confidence interval [low, high] in ticks, or null. */
  confidenceInterval: [number, number] | null;
  /** Ticks by which locked rooms exceed target. >0 means unreachable. */
  overshoot: number;
  /** True if the optimizer could not find a feasible allocation. */
  infeasible: boolean;
  /** True if distributions are still loading. */
  loading: boolean;
};

export function ProbabilityHero({
  probability,
  confidenceInterval,
  overshoot,
  infeasible,
  loading,
}: ProbabilityHeroProps) {
  if (loading) {
    return (
      <div className={styles.probabilityHero}>
        <span className={styles.heroLabel}>
          <i className="fas fa-spinner fa-spin" /> Loading&hellip;
        </span>
      </div>
    );
  }

  if (overshoot > 0) {
    return (
      <div className={styles.probabilityHero}>
        <span className={`${styles.heroValue} ${styles.error}`}>&mdash;</span>
        <span className={styles.heroError}>
          Locked rooms exceed target by {ticksToFormattedSeconds(overshoot)}
        </span>
      </div>
    );
  }

  let heroValue: React.ReactNode;
  let heroLabel: React.ReactNode = null;

  if (probability !== null) {
    const colorClass =
      probability < 0.1
        ? styles.low
        : probability < 0.4
          ? styles.medium
          : styles.high;
    const formatted =
      probability < 0.001 ? '<0.1%' : `${(probability * 100).toFixed(1)}%`;

    heroValue = (
      <span className={`${styles.heroValue} ${colorClass}`}>{formatted}</span>
    );
    heroLabel = (
      <span className={styles.heroLabel}>chance of hitting target</span>
    );
  } else {
    heroValue = <span className={styles.heroValueMuted}>&mdash;</span>;
    if (confidenceInterval === null) {
      heroLabel = <span className={styles.heroLabel}>enter a target time</span>;
    }
  }

  return (
    <div className={styles.probabilityHero}>
      {heroValue}
      {heroLabel}
      {infeasible && (
        <span className={styles.heroError}>
          Requires at least one room faster than any recorded time
        </span>
      )}
      {confidenceInterval !== null && (
        <span className={styles.heroInterval}>
          90% of outcomes between{' '}
          {ticksToFormattedSeconds(confidenceInterval[0])}
          {' — '}
          {ticksToFormattedSeconds(confidenceInterval[1])}
        </span>
      )}
    </div>
  );
}
