/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';

import SettingsProvider from '@/components/settings-provider';
import ToastProvider from '@/components/toast';

import { Column } from '../types';
import { useSearchPresets } from '../use-search-presets';

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

const ACTIVE_COLUMNS_KEY = 'blert-setting:search-active-columns';
const PRESETS_KEY = 'blert-setting:search-presets';

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <SettingsProvider>{children}</SettingsProvider>
    </ToastProvider>
  );
}

function storedValues(): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    values[key] = JSON.parse(localStorage.getItem(key)!);
  }
  return values;
}

describe('useSearchPresets', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the default columns when nothing is saved', () => {
    const { result } = renderHook(() => useSearchPresets(), {
      wrapper: TestWrapper,
    });

    expect({
      activeColumns: result.current.activeColumns,
      presets: result.current.presets,
    }).toEqual({
      activeColumns: [
        { column: Column.DATE },
        { column: Column.TYPE },
        { column: Column.STATUS },
        { column: Column.SCALE },
        { column: Column.PARTY },
        { column: Column.CHALLENGE_TIME },
        { column: Column.OVERALL_TIME },
      ],
      presets: [],
    });
    expect(storedValues()).toEqual({});
  });

  it('rewrites columns saved as numbers with their names', () => {
    localStorage.setItem(
      ACTIVE_COLUMNS_KEY,
      JSON.stringify([{ column: 1 }, { column: 23 }]),
    );
    localStorage.setItem(
      PRESETS_KEY,
      JSON.stringify([
        {
          name: 'Verzik splits',
          id: 4,
          columns: [{ column: 69 }, { column: 'TOB_VERZIK_ROOM' }],
        },
      ]),
    );

    const { result } = renderHook(() => useSearchPresets(), {
      wrapper: TestWrapper,
    });

    expect({
      activeColumns: result.current.activeColumns,
      presets: result.current.presets,
    }).toEqual({
      activeColumns: [
        { column: Column.DATE },
        { column: Column.TOB_VERZIK_P1 },
      ],
      presets: [
        {
          name: 'Verzik splits',
          id: 4,
          columns: [
            { column: Column.TOB_VERZIK_ENTRY },
            { column: Column.TOB_VERZIK_ROOM },
          ],
        },
      ],
    });
    expect(storedValues()).toEqual({
      [ACTIVE_COLUMNS_KEY]: [{ column: 'DATE' }, { column: 'TOB_VERZIK_P1' }],
      [PRESETS_KEY]: [
        {
          name: 'Verzik splits',
          id: 4,
          columns: [
            { column: 'TOB_VERZIK_ENTRY' },
            { column: 'TOB_VERZIK_ROOM' },
          ],
        },
      ],
    });
  });

  it('leaves columns saved as names in place', () => {
    localStorage.setItem(
      ACTIVE_COLUMNS_KEY,
      JSON.stringify([{ column: 'STATUS' }, { column: 'TOB_MAIDEN_ROOM' }]),
    );
    localStorage.setItem(
      PRESETS_KEY,
      JSON.stringify([
        { name: 'Maiden', id: 9, columns: [{ column: 'TOB_MAIDEN_70S' }] },
      ]),
    );

    const { result } = renderHook(() => useSearchPresets(), {
      wrapper: TestWrapper,
    });

    expect({
      activeColumns: result.current.activeColumns,
      presets: result.current.presets,
    }).toEqual({
      activeColumns: [
        { column: Column.STATUS },
        { column: Column.TOB_MAIDEN_ROOM },
      ],
      presets: [
        {
          name: 'Maiden',
          id: 9,
          columns: [{ column: Column.TOB_MAIDEN_70S }],
        },
      ],
    });
    expect(storedValues()).toEqual({
      [ACTIVE_COLUMNS_KEY]: [
        { column: 'STATUS' },
        { column: 'TOB_MAIDEN_ROOM' },
      ],
      [PRESETS_KEY]: [
        { name: 'Maiden', id: 9, columns: [{ column: 'TOB_MAIDEN_70S' }] },
      ],
    });
  });

  it('ignores unknown columns', () => {
    localStorage.setItem(
      ACTIVE_COLUMNS_KEY,
      JSON.stringify([
        { column: 'TOTAL_DEATHS' },
        { column: 'NOT_A_COLUMN' },
        { column: 'TOB_BLOAT_ROOM' },
      ]),
    );
    localStorage.setItem(
      PRESETS_KEY,
      JSON.stringify([
        { name: 'Bloat', id: 12, columns: [{ column: 103 }, { column: 13 }] },
      ]),
    );

    const { result } = renderHook(() => useSearchPresets(), {
      wrapper: TestWrapper,
    });

    expect({
      activeColumns: result.current.activeColumns,
      presets: result.current.presets,
    }).toEqual({
      activeColumns: [
        { column: Column.TOTAL_DEATHS },
        { column: Column.TOB_BLOAT_ROOM },
      ],
      presets: [
        {
          name: 'Bloat',
          id: 12,
          columns: [{ column: Column.TOB_BLOAT_ROOM }],
        },
      ],
    });
    expect(storedValues()).toEqual({
      [ACTIVE_COLUMNS_KEY]: [
        { column: 'TOTAL_DEATHS' },
        { column: 'NOT_A_COLUMN' },
        { column: 'TOB_BLOAT_ROOM' },
      ],
      [PRESETS_KEY]: [
        { name: 'Bloat', id: 12, columns: [{ column: 'TOB_BLOAT_ROOM' }] },
      ],
    });
  });

  it('saves columns and presets', () => {
    const { result } = renderHook(() => useSearchPresets(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.setActiveColumns([
        { column: Column.TOB_VERZIK_P2 },
        { column: Column.SCALE },
      ]);
    });
    act(() => {
      result.current.setPresets([
        {
          name: 'Bloat downs',
          id: 11,
          columns: [{ column: Column.TOB_BLOAT_DOWN_COUNT }],
        },
      ]);
    });

    expect({
      activeColumns: result.current.activeColumns,
      presets: result.current.presets,
    }).toEqual({
      activeColumns: [
        { column: Column.TOB_VERZIK_P2 },
        { column: Column.SCALE },
      ],
      presets: [
        {
          name: 'Bloat downs',
          id: 11,
          columns: [{ column: Column.TOB_BLOAT_DOWN_COUNT }],
        },
      ],
    });
    expect(storedValues()).toEqual({
      [ACTIVE_COLUMNS_KEY]: [{ column: 'TOB_VERZIK_P2' }, { column: 'SCALE' }],
      [PRESETS_KEY]: [
        {
          name: 'Bloat downs',
          id: 11,
          columns: [{ column: 'TOB_BLOAT_DOWN_COUNT' }],
        },
      ],
    });
  });
});
