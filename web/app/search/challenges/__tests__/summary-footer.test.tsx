/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';

import SummaryFooter, { SummaryColumn } from '../summary-footer';
import { AggregateStats } from '../use-aggregate-stats';

// First column is the label slot; col 3 has no field, so it stays blank.
const COLUMNS: SummaryColumn[] = [
  { key: 0 },
  { key: 1, field: 'challengeTicks', render: (v) => `${v}t`, align: 'right' },
  { key: 2, field: 'deaths', render: (v) => `${v}d`, align: 'right' },
  { key: 3 },
  { key: 4, field: 'reds', render: (v) => `${v}r`, align: 'right' },
];

const STATS: AggregateStats = {
  challengeTicks: { count: 1234, avg: 700.4, p50: 259 },
  deaths: { count: 5, avg: 0, p50: 0 },
  reds: { count: 0, avg: 0, p50: 0 },
};

function rowText(container: HTMLElement): string[][] {
  return Array.from(container.querySelectorAll('tfoot tr')).map((row) =>
    Array.from(row.querySelectorAll('td')).map((td) => td.textContent ?? ''),
  );
}

describe('SummaryFooter', () => {
  it('renders a hint instead of stats when the cohort is not comparable', () => {
    const { container } = render(
      <table>
        <SummaryFooter
          columns={COLUMNS}
          stats={null}
          loading={false}
          meaningful={false}
        />
      </table>,
    );

    expect(
      screen.getByText(/Filter to a single challenge type and scale/),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('tfoot tr')).toHaveLength(1);
    expect(screen.queryByText('Median')).not.toBeInTheDocument();
  });

  it('formats each aggregable column, distinguishing a real 0 from no data', () => {
    const { container } = render(
      <table>
        <SummaryFooter
          columns={COLUMNS}
          stats={STATS}
          loading={false}
          meaningful
        />
      </table>,
    );

    // count uses toLocaleString; median/average go through the column renderer.
    // `deaths` has a genuine 0 avg so it renders; `reds` has no data.
    expect(rowText(container)).toEqual([
      ['Median', '259t', '0d', '', '-', ''],
      ['Average', '700.4t', '0d', '', '-', ''],
      ['n', '1,234', '5', '', '0', ''],
    ]);
  });

  it('shows skeletons in aggregable cells while loading before data arrives', () => {
    const { container } = render(
      <table>
        <SummaryFooter columns={COLUMNS} stats={null} loading meaningful />
      </table>,
    );

    // Three aggregable columns across three rows, no data yet.
    expect(container.querySelectorAll('tfoot td span')).toHaveLength(9);
  });
});
