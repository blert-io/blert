/**
 * @jest-environment jsdom
 */
import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  Stage,
} from '@blert/common';
import { render, screen, waitFor } from '@testing-library/react';

import RecentChallengeCard, {
  type RecentChallenge,
} from '../recent-challenge-card';

const COMPLETED: RecentChallenge = {
  uuid: 'completed-abc',
  type: ChallengeType.TOB,
  status: ChallengeStatus.COMPLETED,
  stage: Stage.TOB_VERZIK,
  mode: ChallengeMode.TOB_REGULAR,
  scale: 3,
  startTime: '2026-06-28T00:00:00.000Z',
};

const LIVE: RecentChallenge = {
  ...COMPLETED,
  uuid: 'live-xyz',
  status: ChallengeStatus.IN_PROGRESS,
};

function mockFetch(data: RecentChallenge[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

describe('RecentChallengeCard', () => {
  it('renders the SSR-seeded challenge as a link to the challenge', async () => {
    mockFetch([COMPLETED]);
    render(<RecentChallengeCard username="Foo" initial={COMPLETED} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', `/raids/tob/${COMPLETED.uuid}`);
    expect(link).toHaveTextContent('Most recent');
    expect(link).toHaveTextContent('Theatre of Blood');
    expect(link).toHaveTextContent('Completion');
    expect(link).not.toHaveTextContent('Live');

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  it('renders nothing when the player has no recent challenge', async () => {
    mockFetch([]);
    const { container } = render(
      <RecentChallengeCard username="Foo" initial={null} />,
    );

    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('polls the challenges API scoped to the (URL-encoded) player', async () => {
    mockFetch([COMPLETED]);
    render(<RecentChallengeCard username="Some Name" initial={COMPLETED} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toBe(
      `/api/v1/challenges?party=${encodeURIComponent('Some Name')}&limit=1`,
    );
  });

  it('shows live state when a poll returns an in-progress challenge', async () => {
    mockFetch([LIVE]);
    render(<RecentChallengeCard username="Foo" initial={COMPLETED} />);

    // Initial state is the completed run.
    const link = screen.getByRole('link');
    expect(link).not.toHaveTextContent('Live');

    // The poll swaps in the live run.
    await waitFor(() =>
      expect(screen.getByRole('link')).toHaveTextContent('Live'),
    );
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      `/raids/tob/${LIVE.uuid}`,
    );
  });

  it('appears when a previously idle player starts a challenge', async () => {
    mockFetch([LIVE]);
    const { container } = render(
      <RecentChallengeCard username="Foo" initial={null} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(await screen.findByRole('link')).toHaveTextContent('Live');
  });

  it('disappears when a poll reports no challenges', async () => {
    mockFetch([]);
    render(<RecentChallengeCard username="Foo" initial={COMPLETED} />);

    expect(screen.getByRole('link')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('link')).not.toBeInTheDocument(),
    );
  });
});
