/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';

import { useModifierKey } from '../modifier-key';

function keydown(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

function keyup(key: string) {
  window.dispatchEvent(new KeyboardEvent('keyup', { key }));
}

function blur() {
  window.dispatchEvent(new Event('blur'));
}

describe('useModifierKey', () => {
  it('starts unheld', () => {
    const { result } = renderHook(() => useModifierKey('Alt'));
    expect(result.current).toBe(false);
  });

  it('reports the key as held between keydown and keyup', () => {
    const { result } = renderHook(() => useModifierKey('Alt'));

    act(() => keydown('Alt'));
    expect(result.current).toBe(true);

    act(() => keyup('Alt'));
    expect(result.current).toBe(false);
  });

  it('resets on window blur while held', () => {
    const { result } = renderHook(() => useModifierKey('Alt'));

    act(() => keydown('Alt'));
    expect(result.current).toBe(true);

    act(() => blur());
    expect(result.current).toBe(false);
  });

  it('only tracks the requested key', () => {
    const { result } = renderHook(() => useModifierKey('Alt'));

    act(() => keydown('Shift'));
    expect(result.current).toBe(false);

    act(() => keydown('Alt'));
    expect(result.current).toBe(true);

    act(() => keyup('Shift'));
    expect(result.current).toBe(true);
  });

  it('ignores keydown while disabled', () => {
    const { result } = renderHook(() => useModifierKey('Alt', false));

    act(() => keydown('Alt'));
    expect(result.current).toBe(false);
  });

  it('still clears a held key after being disabled mid-press', () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useModifierKey('Alt', enabled),
      { initialProps: { enabled: true } },
    );

    act(() => keydown('Alt'));
    expect(result.current).toBe(true);

    // Disabling does not retroactively clear an already-held key...
    rerender({ enabled: false });
    expect(result.current).toBe(true);

    // ...but keyup still does.
    act(() => keyup('Alt'));
    expect(result.current).toBe(false);
  });
});
