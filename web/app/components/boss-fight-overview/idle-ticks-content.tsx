import { IdleTickCount } from '@/utils/boss-room-state';

import styles from './style.module.scss';

type IdleTicksContentProps = {
  count: IdleTickCount;
};

export function IdleTicksContent({ count }: IdleTicksContentProps) {
  const { idleTicks, eligibleTicks, longestIdle, idlePeriods } = count;

  const percentage =
    eligibleTicks > 0 ? ((idleTicks / eligibleTicks) * 100).toFixed(1) : null;
  const averageIdle =
    idlePeriods > 0 ? (idleTicks / idlePeriods).toFixed(1) : null;

  return (
    <div className={styles.idleTicks}>
      <div className={styles.total}>
        <span className={styles.count}>{idleTicks}</span>
        <span className={styles.eligible}>/ {eligibleTicks}</span>
        {percentage !== null && (
          <span className={styles.percentage}>({percentage}%)</span>
        )}
      </div>
      {averageIdle !== null && (
        <div className={styles.runs}>
          {idlePeriods} idle period{idlePeriods === 1 ? '' : 's'} · longest{' '}
          {longestIdle} · avg {averageIdle}
        </div>
      )}
    </div>
  );
}
