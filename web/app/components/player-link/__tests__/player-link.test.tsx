/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';

import {
  PlayerLink,
  PlayerTooltipWrapper,
  PLAYER_LINK_TOOLTIP_ID,
} from '../player-link';

describe('PlayerLink', () => {
  const testUsername = 'TestPlayer';

  describe('link behavior', () => {
    it('renders a link to the player profile', () => {
      render(<PlayerLink username={testUsername} />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute(
        'href',
        `/players/${encodeURIComponent(testUsername)}`,
      );
    });

    it('encodes special characters in username', () => {
      const specialUsername = 'Player Name';
      render(<PlayerLink username={specialUsername} />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute(
        'href',
        `/players/${encodeURIComponent(specialUsername)}`,
      );
    });
  });

  describe('content rendering', () => {
    it('renders username when no children provided', () => {
      render(<PlayerLink username={testUsername} />);

      expect(screen.getByText(testUsername)).toBeInTheDocument();
    });

    it('renders username in a styled span', () => {
      const { container } = render(<PlayerLink username={testUsername} />);

      const span = container.querySelector('span');
      expect(span).toBeInTheDocument();
      expect(span).toHaveTextContent(testUsername);
    });

    it('renders children instead of username when provided', () => {
      render(
        <PlayerLink username={testUsername}>
          <span data-testid="custom-child">Custom Content</span>
        </PlayerLink>,
      );

      expect(screen.getByTestId('custom-child')).toBeInTheDocument();
      expect(screen.getByText('Custom Content')).toBeInTheDocument();
    });

    it('does not render default username span when children provided', () => {
      const { container } = render(
        <PlayerLink username={testUsername}>
          <div>Custom Content</div>
        </PlayerLink>,
      );

      const spans = container.querySelectorAll('span');
      const usernameSpan = Array.from(spans).find(
        (span) => span.textContent === testUsername,
      );
      expect(usernameSpan).toBeUndefined();
    });
  });

  describe('tooltip attributes', () => {
    it('sets tooltip id data attribute', () => {
      render(<PlayerLink username={testUsername} />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('data-tooltip-id', PLAYER_LINK_TOOLTIP_ID);
    });

    it('sets tooltip username data attribute', () => {
      render(<PlayerLink username={testUsername} />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('data-tooltip-username', testUsername);
    });
  });

  describe('className prop', () => {
    it('applies className to the link', () => {
      const customClass = 'custom-class';
      render(<PlayerLink username={testUsername} className={customClass} />);

      const link = screen.getByRole('link');
      expect(link).toHaveClass(customClass);
    });

    it('works without className', () => {
      render(<PlayerLink username={testUsername} />);

      const link = screen.getByRole('link');
      expect(link).toBeInTheDocument();
    });
  });
});

describe('PlayerTooltipWrapper', () => {
  const testUsername = 'TestPlayer';

  describe('content rendering', () => {
    it('renders children', () => {
      render(
        <PlayerTooltipWrapper username={testUsername}>
          <span data-testid="child">Child Content</span>
        </PlayerTooltipWrapper>,
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
      expect(screen.getByText('Child Content')).toBeInTheDocument();
    });

    it('renders as a span element', () => {
      const { container } = render(
        <PlayerTooltipWrapper username={testUsername}>
          <div>Content</div>
        </PlayerTooltipWrapper>,
      );

      const wrapper = container.firstChild;
      expect(wrapper?.nodeName).toBe('SPAN');
    });

    it('renders multiple children', () => {
      render(
        <PlayerTooltipWrapper username={testUsername}>
          <span data-testid="child-1">First</span>
          <span data-testid="child-2">Second</span>
        </PlayerTooltipWrapper>,
      );

      expect(screen.getByTestId('child-1')).toBeInTheDocument();
      expect(screen.getByTestId('child-2')).toBeInTheDocument();
    });
  });

  describe('tooltip attributes', () => {
    it('sets tooltip id data attribute', () => {
      const { container } = render(
        <PlayerTooltipWrapper username={testUsername}>
          <div>Content</div>
        </PlayerTooltipWrapper>,
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveAttribute(
        'data-tooltip-id',
        PLAYER_LINK_TOOLTIP_ID,
      );
    });

    it('sets tooltip username data attribute', () => {
      const { container } = render(
        <PlayerTooltipWrapper username={testUsername}>
          <div>Content</div>
        </PlayerTooltipWrapper>,
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveAttribute('data-tooltip-username', testUsername);
    });
  });

  describe('className prop', () => {
    it('applies className to the wrapper span', () => {
      const customClass = 'custom-wrapper-class';
      const { container } = render(
        <PlayerTooltipWrapper username={testUsername} className={customClass}>
          <div>Content</div>
        </PlayerTooltipWrapper>,
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass(customClass);
    });

    it('works without className', () => {
      const { container } = render(
        <PlayerTooltipWrapper username={testUsername}>
          <div>Content</div>
        </PlayerTooltipWrapper>,
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toBeInTheDocument();
    });
  });
});

describe('PLAYER_LINK_TOOLTIP_ID', () => {
  it('exports a non-empty string constant', () => {
    expect(typeof PLAYER_LINK_TOOLTIP_ID).toBe('string');
    expect(PLAYER_LINK_TOOLTIP_ID.length).toBeGreaterThan(0);
  });

  it('has expected value', () => {
    expect(PLAYER_LINK_TOOLTIP_ID).toBe('player-link-tooltip');
  });
});
