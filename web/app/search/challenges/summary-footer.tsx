import { ReactNode } from 'react';

import { AggregateStats, ColumnAggregates } from './use-aggregate-stats';

import styles from './style.module.scss';

export type SummaryColumn = {
  key: number;
  field?: string;
  render?: (value: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number;
};

const ROWS: { key: keyof ColumnAggregates; label: string }[] = [
  { key: 'p50', label: 'Median' },
  { key: 'avg', label: 'Average' },
  { key: 'count', label: 'n' },
];

type SummaryFooterProps = {
  columns: SummaryColumn[];
  stats: AggregateStats | null;
  loading: boolean;
  meaningful: boolean;
};

/**
 * Renders the search table's summary rows from pre-resolved column descriptors.
 */
export default function SummaryFooter({
  columns,
  stats,
  loading,
  meaningful,
}: SummaryFooterProps) {
  if (!meaningful) {
    return (
      <tfoot className={styles.summary}>
        <tr>
          <td colSpan={columns.length + 1} className={styles.summaryHint}>
            <i className="fas fa-circle-info" />
            Filter to a single challenge type and scale to see aggregate stats.
          </td>
        </tr>
      </tfoot>
    );
  }

  return (
    <tfoot className={styles.summary}>
      {ROWS.map((row) => (
        <tr key={row.key}>
          {columns.map((col, idx) => {
            if (idx === 0) {
              return (
                <td
                  key={col.key}
                  className={styles.summaryLabel}
                  style={{ width: col.width }}
                >
                  {row.label}
                </td>
              );
            }

            let content: ReactNode = null;
            if (col.field !== undefined && col.render !== undefined) {
              const values = stats?.[col.field];
              if (values === undefined) {
                content = loading ? (
                  <span className={styles.summarySkeleton} />
                ) : (
                  '-'
                );
              } else if (row.key === 'count') {
                content = values.count.toLocaleString();
              } else if (values.count === 0) {
                content = '-';
              } else {
                content = col.render(values[row.key]!);
              }
            }

            return (
              <td
                key={col.key}
                style={{ textAlign: col.align ?? 'left', width: col.width }}
              >
                {content}
              </td>
            );
          })}
          <td style={{ width: 40, padding: 0 }} />
        </tr>
      ))}
    </tfoot>
  );
}
