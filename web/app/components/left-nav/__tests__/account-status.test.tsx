/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import AccountStatus, { AccountStatusSkeleton } from '../account-status';

const mockReplace = jest.fn();
const mockSignOut = jest.fn<Promise<{ url: string }>, [unknown]>();
const mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/'),
  useRouter: jest.fn(() => ({
    replace: mockReplace,
  })),
  useSearchParams: jest.fn(() => mockSearchParams),
}));

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
  signOut: jest.fn((...args: [unknown]) => mockSignOut(...args)),
}));

import { useSession } from 'next-auth/react';
import { usePathname, useSearchParams } from 'next/navigation';

const mockUseSession = useSession as jest.Mock;
const mockUsePathname = usePathname as jest.Mock;
const mockUseSearchParams = useSearchParams as jest.Mock;

describe('AccountStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/');
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
  });

  describe('loading state', () => {
    beforeEach(() => {
      mockUseSession.mockReturnValue({ status: 'loading', data: null });
    });

    it('renders skeleton UI when loading', () => {
      const { container } = render(<AccountStatus />);

      const skeleton = container.querySelector('[class*="skeleton"]');
      expect(skeleton).toBeInTheDocument();
    });

    it('renders skeleton avatar', () => {
      const { container } = render(<AccountStatus />);

      const avatar = container.querySelector('[class*="avatar"]');
      expect(avatar).toBeInTheDocument();
      expect(avatar?.className).toContain('skeleton');
    });

    it('renders skeleton text elements', () => {
      const { container } = render(<AccountStatus />);

      const skeletonTexts = container.querySelectorAll(
        '[class*="skeletonText"]',
      );
      expect(skeletonTexts).toHaveLength(2);
    });

    it('renders skeleton action buttons', () => {
      const { container } = render(<AccountStatus />);

      const skeletonActions = container.querySelectorAll(
        '[class*="skeletonAction"]',
      );
      expect(skeletonActions).toHaveLength(2);
    });

    it('does not render login or signup buttons', () => {
      render(<AccountStatus />);

      expect(screen.queryByText('Log In')).not.toBeInTheDocument();
      expect(screen.queryByText('Sign Up')).not.toBeInTheDocument();
    });

    it('does not render user info', () => {
      render(<AccountStatus />);

      expect(screen.queryByText('Signed in as')).not.toBeInTheDocument();
    });
  });

  describe('AccountStatusSkeleton', () => {
    it('renders skeleton UI independently', () => {
      const { container } = render(<AccountStatusSkeleton />);

      const skeleton = container.querySelector('[class*="skeleton"]');
      expect(skeleton).toBeInTheDocument();
    });

    it('renders skeleton avatar', () => {
      const { container } = render(<AccountStatusSkeleton />);

      const avatar = container.querySelector('[class*="avatar"]');
      expect(avatar).toBeInTheDocument();
      expect(avatar?.className).toContain('skeleton');
    });

    it('renders skeleton text elements', () => {
      const { container } = render(<AccountStatusSkeleton />);

      const skeletonTexts = container.querySelectorAll(
        '[class*="skeletonText"]',
      );
      expect(skeletonTexts).toHaveLength(2);
    });

    it('renders skeleton action buttons', () => {
      const { container } = render(<AccountStatusSkeleton />);

      const skeletonActions = container.querySelectorAll(
        '[class*="skeletonAction"]',
      );
      expect(skeletonActions).toHaveLength(2);
    });
  });

  describe('authenticated state', () => {
    beforeEach(() => {
      mockUseSession.mockReturnValue({
        status: 'authenticated',
        data: { user: { name: 'TestUser' } },
      });
    });

    it('displays "Signed in as" label', () => {
      render(<AccountStatus />);

      expect(screen.getByText('Signed in as')).toBeInTheDocument();
    });

    it('displays the username', () => {
      render(<AccountStatus />);

      expect(screen.getByText('TestUser')).toBeInTheDocument();
    });

    it('displays "Unknown" when username is null', () => {
      mockUseSession.mockReturnValue({
        status: 'authenticated',
        data: { user: { name: null } },
      });

      render(<AccountStatus />);

      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    it('renders settings link', () => {
      render(<AccountStatus />);

      const settingsLink = screen.getByText('Settings').closest('a');
      expect(settingsLink).toBeInTheDocument();
      expect(settingsLink).toHaveAttribute('href', '/settings');
    });

    it('renders logout button', () => {
      render(<AccountStatus />);

      expect(screen.getByText('Log Out')).toBeInTheDocument();
    });

    it('renders user avatar icon', () => {
      const { container } = render(<AccountStatus />);

      const avatarIcon = container.querySelector('.fa-user');
      expect(avatarIcon).toBeInTheDocument();
    });

    it('renders settings icon', () => {
      const { container } = render(<AccountStatus />);

      const settingsIcon = container.querySelector('.fa-gear');
      expect(settingsIcon).toBeInTheDocument();
    });

    it('renders logout icon', () => {
      const { container } = render(<AccountStatus />);

      const logoutIcon = container.querySelector('.fa-right-from-bracket');
      expect(logoutIcon).toBeInTheDocument();
    });

    it('does not render login or signup buttons', () => {
      render(<AccountStatus />);

      expect(screen.queryByText('Log In')).not.toBeInTheDocument();
      expect(screen.queryByText('Sign Up')).not.toBeInTheDocument();
    });
  });

  describe('unauthenticated state', () => {
    beforeEach(() => {
      mockUseSession.mockReturnValue({ status: 'unauthenticated', data: null });
    });

    it('renders login button', () => {
      render(<AccountStatus />);

      expect(screen.getByText('Log In')).toBeInTheDocument();
    });

    it('renders signup button', () => {
      render(<AccountStatus />);

      expect(screen.getByText('Sign Up')).toBeInTheDocument();
    });

    it('login link includes current path as next parameter', () => {
      mockUsePathname.mockReturnValue('/some/page');

      render(<AccountStatus />);

      const loginLink = screen.getByText('Log In').closest('a');
      expect(loginLink).toHaveAttribute('href', '/login?next=%2Fsome%2Fpage');
    });

    it('signup link includes current path as next parameter', () => {
      mockUsePathname.mockReturnValue('/another/page');

      render(<AccountStatus />);

      const signupLink = screen.getByText('Sign Up').closest('a');
      expect(signupLink).toHaveAttribute(
        'href',
        '/register?next=%2Fanother%2Fpage',
      );
    });

    it('login link includes search params in next parameter', () => {
      mockUsePathname.mockReturnValue('/raids/tob');
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams('scale=5&status=1'),
      );

      render(<AccountStatus />);

      const loginLink = screen.getByText('Log In').closest('a');
      expect(loginLink).toHaveAttribute(
        'href',
        '/login?next=%2Fraids%2Ftob%3Fscale%3D5%26status%3D1',
      );
    });

    it('signup link includes search params in next parameter', () => {
      mockUsePathname.mockReturnValue('/leaderboards/tob/regular/5');
      mockUseSearchParams.mockReturnValue(new URLSearchParams('limit=10'));

      render(<AccountStatus />);

      const signupLink = screen.getByText('Sign Up').closest('a');
      expect(signupLink).toHaveAttribute(
        'href',
        '/register?next=%2Fleaderboards%2Ftob%2Fregular%2F5%3Flimit%3D10',
      );
    });

    it('does not append ? when there are no search params', () => {
      mockUsePathname.mockReturnValue('/raids/tob/123');
      mockUseSearchParams.mockReturnValue(new URLSearchParams());

      render(<AccountStatus />);

      const loginLink = screen.getByText('Log In').closest('a');
      expect(loginLink).toHaveAttribute(
        'href',
        '/login?next=%2Fraids%2Ftob%2F123',
      );
    });

    it('renders login icon', () => {
      const { container } = render(<AccountStatus />);

      const loginIcon = container.querySelector('.fa-right-to-bracket');
      expect(loginIcon).toBeInTheDocument();
    });

    it('renders signup icon', () => {
      const { container } = render(<AccountStatus />);

      const signupIcon = container.querySelector('.fa-user-plus');
      expect(signupIcon).toBeInTheDocument();
    });

    it('does not render user info', () => {
      render(<AccountStatus />);

      expect(screen.queryByText('Signed in as')).not.toBeInTheDocument();
    });

    it('does not render settings or logout', () => {
      render(<AccountStatus />);

      expect(screen.queryByText('Settings')).not.toBeInTheDocument();
      expect(screen.queryByText('Log Out')).not.toBeInTheDocument();
    });
  });

  describe('logout functionality', () => {
    beforeEach(() => {
      mockUseSession.mockReturnValue({
        status: 'authenticated',
        data: { user: { name: 'TestUser' } },
      });
    });

    it('calls signOut when logout button is clicked', async () => {
      mockSignOut.mockResolvedValue({ url: '/' });

      render(<AccountStatus />);

      fireEvent.click(screen.getByText('Log Out'));

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled();
      });
    });

    it('redirects to home when on protected route', async () => {
      mockUsePathname.mockReturnValue('/dashboard');
      mockSignOut.mockResolvedValue({ url: '/' });

      render(<AccountStatus />);

      fireEvent.click(screen.getByText('Log Out'));

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalledWith({
          redirect: false,
          callbackUrl: '/',
        });
      });
    });

    it('redirects to current page when on non-protected route', async () => {
      mockUsePathname.mockReturnValue('/raids/123');
      mockSignOut.mockResolvedValue({ url: '/raids/123' });

      render(<AccountStatus />);

      fireEvent.click(screen.getByText('Log Out'));

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalledWith({
          redirect: false,
          callbackUrl: '/raids/123',
        });
      });
    });

    it('redirects to home when on settings page', async () => {
      mockUsePathname.mockReturnValue('/settings');
      mockSignOut.mockResolvedValue({ url: '/' });

      render(<AccountStatus />);

      fireEvent.click(screen.getByText('Log Out'));

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalledWith({
          redirect: false,
          callbackUrl: '/',
        });
      });
    });

    it('calls router.replace with signOut url', async () => {
      mockSignOut.mockResolvedValue({ url: '/custom-redirect' });

      render(<AccountStatus />);

      fireEvent.click(screen.getByText('Log Out'));

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/custom-redirect');
      });
    });
  });
});
