/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';

import { useVisibleInterval } from '../visible-interval';

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useVisibleInterval', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setHidden(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
  });

  it('invokes the callback immediately on mount', () => {
    const cb = jest.fn();
    renderHook(() => useVisibleInterval(cb, 1000));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('invokes the callback on each interval while visible', () => {
    const cb = jest.fn();
    renderHook(() => useVisibleInterval(cb, 1000));
    expect(cb).toHaveBeenCalledTimes(1);

    act(() => jest.advanceTimersByTime(1000));
    expect(cb).toHaveBeenCalledTimes(2);

    act(() => jest.advanceTimersByTime(2000));
    expect(cb).toHaveBeenCalledTimes(4);
  });

  it('pauses while hidden and resumes immediately when visible again', () => {
    const cb = jest.fn();
    renderHook(() => useVisibleInterval(cb, 1000));
    expect(cb).toHaveBeenCalledTimes(1);

    act(() => setHidden(true));
    act(() => jest.advanceTimersByTime(5000));
    expect(cb).toHaveBeenCalledTimes(1);

    act(() => setHidden(false));
    expect(cb).toHaveBeenCalledTimes(2);

    act(() => jest.advanceTimersByTime(1000));
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('stops invoking the callback after unmount', () => {
    const cb = jest.fn();
    const { unmount } = renderHook(() => useVisibleInterval(cb, 1000));
    expect(cb).toHaveBeenCalledTimes(1);

    unmount();
    act(() => jest.advanceTimersByTime(5000));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('invokes the latest callback without restarting the interval', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = renderHook(({ cb }) => useVisibleInterval(cb, 1000), {
      initialProps: { cb: first },
    });
    expect(first).toHaveBeenCalledTimes(1);

    // Swapping the callback does not trigger an immediate call.
    rerender({ cb: second });
    expect(second).toHaveBeenCalledTimes(0);

    act(() => jest.advanceTimersByTime(1000));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });
});
