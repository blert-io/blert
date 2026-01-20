/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';

import SettingsProvider from '@/components/settings-provider';
import ToastProvider from '@/components/toast';

import NyloDimSettings, { DimThreshold, NyloDimConfig } from '../dim-settings';

jest.mock('@/auth-client', () => ({
  authClient: {
    useSession: () => ({ isPending: false, data: null }),
  },
}));

jest.mock('@/actions/settings', () => ({
  getUserSettings: jest.fn().mockResolvedValue(null),
  setUserSetting: jest.fn().mockResolvedValue(undefined),
  syncSettings: jest.fn().mockResolvedValue({}),
}));

const SETTINGS_KEY_PREFIX = 'blert-setting:';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] || null,
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <SettingsProvider>{children}</SettingsProvider>
    </ToastProvider>
  );
}

describe('NyloDimSettings', () => {
  let onChangeMock: jest.Mock<void, [DimThreshold[]]>;
  let onShowLabelsChangeMock: jest.Mock<void, [boolean]>;

  beforeEach(() => {
    localStorageMock.clear();
    onChangeMock = jest.fn<void, [DimThreshold[]]>();
    onShowLabelsChangeMock = jest.fn<void, [boolean]>();
  });

  const renderComponent = (
    props: Partial<Parameters<typeof NyloDimSettings>[0]> = {},
  ) => {
    return render(
      <TestWrapper>
        <NyloDimSettings
          scale={5}
          onDimThresholdsChange={onChangeMock}
          onShowLabelsChange={onShowLabelsChangeMock}
          {...props}
        />
      </TestWrapper>,
    );
  };

  describe('initial rendering', () => {
    it('renders the Dim label', () => {
      renderComponent();
      expect(screen.getByText('Dim:')).toBeInTheDocument();
    });

    it('renders all preset options', () => {
      renderComponent();

      expect(screen.getByLabelText('None')).toBeInTheDocument();
      expect(screen.getByLabelText('W26')).toBeInTheDocument();
      expect(screen.getByLabelText('W27')).toBeInTheDocument();
      expect(screen.getByLabelText('W27+4')).toBeInTheDocument();
      expect(screen.getByLabelText('W28')).toBeInTheDocument();
      expect(screen.getByLabelText('W29')).toBeInTheDocument();
    });

    it('renders the Custom button', () => {
      renderComponent();
      expect(screen.getByText('Custom')).toBeInTheDocument();
    });

    it('has None selected by default', () => {
      renderComponent();
      expect(screen.getByLabelText('None')).toBeChecked();
    });

    it('calls onChange with empty array on mount when no preset selected', () => {
      renderComponent();
      expect(onChangeMock).toHaveBeenCalledWith([]);
    });

    it('renders the Show wave numbers checkbox', () => {
      renderComponent();
      expect(screen.getByLabelText('Show wave numbers')).toBeInTheDocument();
    });

    it('has Show wave numbers checked by default', () => {
      renderComponent();
      expect(screen.getByLabelText('Show wave numbers')).toBeChecked();
    });

    it('calls onShowLabelsChange with true on mount', () => {
      renderComponent();
      expect(onShowLabelsChangeMock).toHaveBeenCalledWith(true);
    });
  });

  describe('preset selection', () => {
    it('selects W27 preset when clicked', () => {
      renderComponent();

      fireEvent.click(screen.getByLabelText('W27'));

      expect(screen.getByLabelText('W27')).toBeChecked();
      expect(screen.getByLabelText('None')).not.toBeChecked();
    });

    it('calls onChange with preset threshold when preset selected', () => {
      renderComponent();

      fireEvent.click(screen.getByLabelText('W28'));

      expect(onChangeMock).toHaveBeenLastCalledWith([{ wave: 28, offset: 0 }]);
    });

    it('calls onChange with W27+4 offset threshold', () => {
      renderComponent();

      fireEvent.click(screen.getByLabelText('W27+4'));

      expect(onChangeMock).toHaveBeenLastCalledWith([{ wave: 27, offset: 4 }]);
    });

    it('deselects preset when None is clicked', () => {
      renderComponent();

      fireEvent.click(screen.getByLabelText('W26'));
      fireEvent.click(screen.getByLabelText('None'));

      expect(screen.getByLabelText('None')).toBeChecked();
      expect(onChangeMock).toHaveBeenLastCalledWith([]);
    });

    it('only allows one preset to be selected at a time', () => {
      renderComponent();

      fireEvent.click(screen.getByLabelText('W26'));
      expect(screen.getByLabelText('W26')).toBeChecked();

      fireEvent.click(screen.getByLabelText('W29'));
      expect(screen.getByLabelText('W29')).toBeChecked();
      expect(screen.getByLabelText('W26')).not.toBeChecked();
    });
  });

  describe('custom dropdown', () => {
    it('opens dropdown when Custom button is clicked', () => {
      renderComponent();

      fireEvent.click(screen.getByText('Custom'));

      expect(screen.getByText('Wave')).toBeInTheDocument();
      expect(screen.getByText('Offset')).toBeInTheDocument();
      expect(screen.getByText('Add')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('closes dropdown when Cancel is clicked', () => {
      renderComponent();

      fireEvent.click(screen.getByText('Custom'));
      expect(screen.getByText('Wave')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByText('Wave')).not.toBeInTheDocument();
    });

    it('adds custom threshold when Add is clicked', () => {
      renderComponent();

      fireEvent.click(screen.getByText('Custom'));

      const waveInput = screen.getByRole('spinbutton', { name: /wave/i });
      const offsetInput = screen.getByRole('spinbutton', { name: /offset/i });

      fireEvent.change(waveInput, { target: { value: '21' } });
      fireEvent.change(offsetInput, { target: { value: '3' } });
      fireEvent.click(screen.getByText('Add'));

      expect(onChangeMock).toHaveBeenLastCalledWith([{ wave: 21, offset: 3 }]);
    });

    it('displays custom threshold as chip after adding', () => {
      renderComponent();

      fireEvent.click(screen.getByText('Custom'));
      const waveInput = screen.getByRole('spinbutton', { name: /wave/i });
      fireEvent.change(waveInput, { target: { value: '25' } });
      fireEvent.click(screen.getByText('Add'));

      expect(screen.getByText('W25')).toBeInTheDocument();
    });

    it('displays custom threshold with offset in chip', () => {
      renderComponent();

      fireEvent.click(screen.getByText('Custom'));
      const waveInput = screen.getByRole('spinbutton', { name: /wave/i });
      const offsetInput = screen.getByRole('spinbutton', { name: /offset/i });
      fireEvent.change(waveInput, { target: { value: '22' } });
      fireEvent.change(offsetInput, { target: { value: '5' } });
      fireEvent.click(screen.getByText('Add'));

      expect(screen.getByText('W22+5')).toBeInTheDocument();
    });

    it('removes custom threshold when chip is clicked', () => {
      renderComponent();

      // Add custom threshold
      fireEvent.click(screen.getByText('Custom'));
      const waveInput = screen.getByRole('spinbutton', { name: /wave/i });
      fireEvent.change(waveInput, { target: { value: '23' } });
      fireEvent.click(screen.getByText('Add'));

      expect(screen.getByText('W23')).toBeInTheDocument();

      // Remove it
      fireEvent.click(screen.getByText('W23'));

      expect(screen.queryByText('W23')).not.toBeInTheDocument();
      expect(onChangeMock).toHaveBeenLastCalledWith([]);
    });

    it('does not add duplicate custom thresholds', () => {
      renderComponent();

      // Add first threshold
      fireEvent.click(screen.getByText('Custom'));
      fireEvent.click(screen.getByText('Add'));

      // Try to add same threshold again
      fireEvent.click(screen.getByText('Custom'));
      fireEvent.click(screen.getByText('Add'));

      // Should only have one chip
      const chips = screen.getAllByTitle('Click to remove');
      expect(chips).toHaveLength(1);
    });

    it('closes dropdown after adding threshold', () => {
      renderComponent();

      fireEvent.click(screen.getByText('Custom'));
      expect(screen.getByText('Wave')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Add'));
      expect(screen.queryByText('Wave')).not.toBeInTheDocument();
    });
  });

  describe('combined preset and custom', () => {
    it('includes both preset and custom thresholds in onChange', () => {
      renderComponent();

      // Select preset
      fireEvent.click(screen.getByLabelText('W28'));

      // Add custom
      fireEvent.click(screen.getByText('Custom'));
      const waveInput = screen.getByRole('spinbutton', { name: /wave/i });
      fireEvent.change(waveInput, { target: { value: '21' } });
      fireEvent.click(screen.getByText('Add'));

      expect(onChangeMock).toHaveBeenLastCalledWith([
        { wave: 28, offset: 0 },
        { wave: 21, offset: 0 },
      ]);
    });
  });

  describe('disabled state', () => {
    it('disables all preset radio buttons when disabled', () => {
      renderComponent({ disabled: true });

      expect(screen.getByLabelText('None')).toBeDisabled();
      expect(screen.getByLabelText('W26')).toBeDisabled();
      expect(screen.getByLabelText('W27')).toBeDisabled();
    });

    it('disables Custom button when disabled', () => {
      renderComponent({ disabled: true });

      expect(screen.getByText('Custom')).toBeDisabled();
    });

    it('disables Show wave numbers checkbox when disabled', () => {
      renderComponent({ disabled: true });

      expect(screen.getByLabelText('Show wave numbers')).toBeDisabled();
    });
  });

  describe('persistence', () => {
    it('persists preset selection to localStorage', () => {
      renderComponent();

      fireEvent.click(screen.getByLabelText('W27'));

      const stored = JSON.parse(
        localStorageMock.getItem(`${SETTINGS_KEY_PREFIX}nylo-dims-5`)!,
      ) as NyloDimConfig;
      expect(stored.preset).toEqual({ wave: 27, offset: 0 });
    });

    it('uses scale-specific localStorage key', () => {
      renderComponent({ scale: 3 });

      fireEvent.click(screen.getByLabelText('W26'));

      expect(
        localStorageMock.getItem(`${SETTINGS_KEY_PREFIX}nylo-dims-3`),
      ).toBeTruthy();
      expect(
        localStorageMock.getItem(`${SETTINGS_KEY_PREFIX}nylo-dims-5`),
      ).toBeNull();
    });

    it('restores preset from localStorage on mount', () => {
      localStorageMock.setItem(
        `${SETTINGS_KEY_PREFIX}nylo-dims-5`,
        JSON.stringify({ preset: { wave: 29, offset: 0 }, custom: [] }),
      );

      renderComponent();

      expect(screen.getByLabelText('W29')).toBeChecked();
      expect(onChangeMock).toHaveBeenCalledWith([{ wave: 29, offset: 0 }]);
    });

    it('restores custom thresholds from localStorage on mount', () => {
      localStorageMock.setItem(
        `${SETTINGS_KEY_PREFIX}nylo-dims-5`,
        JSON.stringify({
          preset: null,
          custom: [{ wave: 21, offset: 2 }],
        }),
      );

      renderComponent();

      expect(screen.getByText('W21+2')).toBeInTheDocument();
      expect(onChangeMock).toHaveBeenCalledWith([{ wave: 21, offset: 2 }]);
    });
  });

  describe('keyboard interactions', () => {
    it('adds threshold on Enter key in dropdown', () => {
      renderComponent();

      fireEvent.click(screen.getByText('Custom'));
      const waveInput = screen.getByRole('spinbutton', { name: /wave/i });
      fireEvent.change(waveInput, { target: { value: '24' } });
      fireEvent.keyDown(waveInput, { key: 'Enter' });

      expect(screen.getByText('W24')).toBeInTheDocument();
    });

    it('closes dropdown on Escape key', () => {
      renderComponent();

      fireEvent.click(screen.getByText('Custom'));
      expect(screen.getByText('Wave')).toBeInTheDocument();

      const waveInput = screen.getByRole('spinbutton', { name: /wave/i });
      fireEvent.keyDown(waveInput, { key: 'Escape' });

      expect(screen.queryByText('Wave')).not.toBeInTheDocument();
    });
  });

  describe('show wave numbers checkbox', () => {
    it('toggles show wave numbers when clicked', () => {
      renderComponent();

      const checkbox = screen.getByLabelText('Show wave numbers');
      expect(checkbox).toBeChecked();

      fireEvent.click(checkbox);
      expect(checkbox).not.toBeChecked();
      expect(onShowLabelsChangeMock).toHaveBeenLastCalledWith(false);

      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
      expect(onShowLabelsChangeMock).toHaveBeenLastCalledWith(true);
    });

    it('persists show wave numbers setting to localStorage', () => {
      renderComponent();

      fireEvent.click(screen.getByLabelText('Show wave numbers'));

      expect(
        localStorageMock.getItem(`${SETTINGS_KEY_PREFIX}nylo-show-labels`),
      ).toBe('false');
    });

    it('restores show wave numbers from localStorage on mount', () => {
      localStorageMock.setItem(
        `${SETTINGS_KEY_PREFIX}nylo-show-labels`,
        'false',
      );

      renderComponent();

      expect(screen.getByLabelText('Show wave numbers')).not.toBeChecked();
      expect(onShowLabelsChangeMock).toHaveBeenCalledWith(false);
    });
  });
});
