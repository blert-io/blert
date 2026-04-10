'use client';

import { Fragment, useMemo } from 'react';

import { Series } from './bloat-downs';

import styles from './table.module.scss';

type Row = {
  ticks: number;
  cells: { count: number; percent: number; cdf: number }[];
};

type BloatDownsTableProps = {
  series: Series[];
};

export default function BloatDownsTable({ series }: BloatDownsTableProps) {
  const { rows, totals } = useMemo(() => {
    const allTicks = new Set<number>();
    for (const s of series) {
      if (s.data === null) {
        continue;
      }
      for (const key of Object.keys(s.data.byWalkTicks)) {
        allTicks.add(parseInt(key));
      }
    }

    const sortedTicks = Array.from(allTicks).sort((a, b) => a - b);
    const totals = series.map((s) => {
      if (s.data === null) {
        return 0;
      }
      let total = 0;
      for (const count of Object.values(s.data.byWalkTicks)) {
        total += count;
      }
      return total;
    });

    const cumulative = series.map(() => 0);
    const rows: Row[] = sortedTicks.map((ticks) => ({
      ticks,
      cells: series.map((s, i) => {
        const count = s.data?.byWalkTicks[ticks.toString()] ?? 0;
        cumulative[i] += count;
        const percent = totals[i] > 0 ? (count / totals[i]) * 100 : 0;
        const cdf = totals[i] > 0 ? (cumulative[i] / totals[i]) * 100 : 0;
        return { count, percent, cdf };
      }),
    }));

    return { rows, totals };
  }, [series]);

  if (rows.length === 0) {
    return (
      <div className={styles.empty}>No bloat downs match these filters.</div>
    );
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th rowSpan={2} className={styles.walkTimeCol}>
              Walk time
            </th>
            {series.map((s) => (
              <th
                key={s.id}
                colSpan={3}
                className={styles.seriesHeader}
                style={{ color: s.color }}
              >
                <span
                  className={styles.swatch}
                  style={{ background: s.color }}
                />
                {s.label}
              </th>
            ))}
          </tr>
          <tr>
            {series.map((s) => (
              <Fragment key={s.id}>
                <th className={`${styles.numeric} ${styles.seriesStart}`}>
                  Count
                </th>
                <th className={styles.numeric}>%</th>
                <th className={styles.numeric}>CDF</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ticks}>
              <td className={styles.walkTimeCol}>
                <div className={styles.walkTimeContent}>
                  <span className={styles.ticks}>{row.ticks}t</span>
                </div>
              </td>
              {row.cells.map((cell, i) => {
                const zero = cell.count === 0 ? styles.zero : '';
                return (
                  <Fragment key={i}>
                    <td
                      className={`${styles.numeric} ${styles.seriesStart} ${zero}`}
                    >
                      {cell.count.toLocaleString()}
                    </td>
                    <td className={`${styles.numeric} ${zero}`}>
                      {cell.percent.toFixed(2)}%
                    </td>
                    <td className={`${styles.numeric} ${zero}`}>
                      {cell.cdf.toFixed(1)}%
                    </td>
                  </Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className={styles.walkTimeCol}>Total</td>
            {totals.map((total, i) => (
              <Fragment key={i}>
                <td className={`${styles.numeric} ${styles.seriesStart}`}>
                  {total.toLocaleString()}
                </td>
                <td className={styles.numeric}>100%</td>
                <td className={styles.numeric}>100.0%</td>
              </Fragment>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
