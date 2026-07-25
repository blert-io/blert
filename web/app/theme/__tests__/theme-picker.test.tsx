/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';

import { trackEvent } from '@/utils/analytics';

import ThemePicker from '../theme-picker';
import { THEMES } from '../themes';

jest.mock('@/utils/analytics');

const mockTrackEvent = jest.mocked(trackEvent);

jest.mock('@/components/settings-provider', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  return {
    useSettingsContext: () => {
      const [settings, setSettings] = react.useState<Record<string, unknown>>(
        {},
      );
      const updateSetting = react.useCallback((key: string, value: unknown) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
      }, []);
      return { settings, isLoading: false, updateSetting };
    },
  };
});

function openPicker() {
  fireEvent.click(screen.getByLabelText('Change theme'));
}

function closePicker() {
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
}

function selectTheme(label: string) {
  const card = screen.getByText(label).closest('button');
  expect(card).not.toBeNull();
  fireEvent.click(card!);
}

describe('ThemePicker', () => {
  beforeEach(() => {
    const portalRoot = document.createElement('div');
    portalRoot.id = 'portal-root';
    document.body.appendChild(portalRoot);
  });

  afterEach(() => {
    document.getElementById('portal-root')?.remove();
  });

  it('lists every theme once opened', () => {
    render(<ThemePicker />);
    openPicker();

    for (const theme of THEMES) {
      expect(screen.getByText(theme.label)).toBeInTheDocument();
    }
  });

  it('reports the active theme and entry point when opened', () => {
    render(<ThemePicker variant="mini" />);
    openPicker();

    expect(mockTrackEvent.mock.calls).toEqual([
      ['theme_picker_opened', { theme: 'blert', variant: 'mini' }],
    ]);
  });

  it('reports the theme in effect when the picker closes', () => {
    render(<ThemePicker />);

    openPicker();
    selectTheme('Outrun');
    closePicker();

    expect(mockTrackEvent.mock.calls).toEqual([
      ['theme_picker_opened', { theme: 'blert', variant: 'chip' }],
      ['theme_changed', { from: 'blert', to: 'outrun' }],
    ]);

    // The applied theme becomes the baseline for the next visit to the picker.
    openPicker();
    closePicker();

    expect(mockTrackEvent.mock.calls).toEqual([
      ['theme_picker_opened', { theme: 'blert', variant: 'chip' }],
      ['theme_changed', { from: 'blert', to: 'outrun' }],
      ['theme_picker_opened', { theme: 'outrun', variant: 'chip' }],
    ]);
  });

  it('reports only the final theme when several are previewed', () => {
    render(<ThemePicker />);

    openPicker();
    selectTheme('Outrun');
    selectTheme('Ashfall');
    selectTheme('Necropolis');
    closePicker();

    expect(mockTrackEvent.mock.calls).toEqual([
      ['theme_picker_opened', { theme: 'blert', variant: 'chip' }],
      ['theme_changed', { from: 'blert', to: 'necropolis' }],
    ]);
  });

  it('reports no change when a preview is reverted before closing', () => {
    render(<ThemePicker />);

    openPicker();
    selectTheme('Outrun');
    selectTheme('Blert');
    closePicker();

    expect(mockTrackEvent.mock.calls).toEqual([
      ['theme_picker_opened', { theme: 'blert', variant: 'chip' }],
    ]);
  });

  it('reports no change when the picker closes untouched', () => {
    render(<ThemePicker />);

    openPicker();
    closePicker();

    expect(mockTrackEvent.mock.calls).toEqual([
      ['theme_picker_opened', { theme: 'blert', variant: 'chip' }],
    ]);
  });
});
