/**
 * @jest-environment jsdom
 */
import { ChallengeMode } from '@blert/common';
import { render, screen } from '@testing-library/react';

import BloatHandsStats from '../stats';

describe('BloatHandsStats', () => {
  it('renders 0.0 average hands per raid when there are no matching raids', () => {
    render(
      <BloatHandsStats
        data={{
          totalChallenges: 0,
          totalHands: 0,
          byTile: {},
        }}
        displayMode="percentage"
        filters={{
          mode: ChallengeMode.TOB_REGULAR,
          startDate: null,
          endDate: null,
        }}
      />,
    );

    expect(screen.getByText('Avg per Raid')).toBeInTheDocument();
    expect(screen.getByText('0.0')).toBeInTheDocument();
  });
});
