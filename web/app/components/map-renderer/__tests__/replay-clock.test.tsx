/**
 * @jest-environment jsdom
 */
import { act, render } from '@testing-library/react';

import Map from '../map';
import { TimeoutReplayClock } from '../replay-clock';

jest.mock('@react-three/fiber', () => ({ useFrame: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('TimeoutReplayClock', () => {
  it('advances once per tick duration while playing', () => {
    const onTick = jest.fn();
    const { rerender } = render(
      <Map
        config={{
          interpolationEnabled: false,
          tickDuration: 450,
          debug: false,
        }}
        mapDefinition={{ baseX: 3154, baseY: 4372, width: 32, height: 32 }}
        playing
        currentTick={3}
        onTick={onTick}
      >
        <TimeoutReplayClock />
      </Map>,
    );

    act(() => jest.advanceTimersByTime(449));
    expect(onTick).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(1));
    expect(onTick).toHaveBeenCalledTimes(1);

    rerender(
      <Map
        config={{
          interpolationEnabled: false,
          tickDuration: 450,
          debug: false,
        }}
        mapDefinition={{ baseX: 3154, baseY: 4372, width: 32, height: 32 }}
        playing
        currentTick={4}
        onTick={onTick}
      >
        <TimeoutReplayClock />
      </Map>,
    );

    act(() => jest.advanceTimersByTime(450));
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('does not advance while paused', () => {
    const onTick = jest.fn();
    render(
      <Map
        config={{
          interpolationEnabled: false,
          tickDuration: 500,
          debug: false,
        }}
        mapDefinition={{ baseX: 3154, baseY: 4372, width: 32, height: 32 }}
        playing={false}
        currentTick={7}
        onTick={onTick}
      >
        <TimeoutReplayClock />
      </Map>,
    );

    act(() => jest.advanceTimersByTime(5000));
    expect(onTick).not.toHaveBeenCalled();
  });

  it('waits a full tick duration after a seek', () => {
    const onTick = jest.fn();
    const { rerender } = render(
      <Map
        config={{
          interpolationEnabled: false,
          tickDuration: 550,
          debug: false,
        }}
        mapDefinition={{ baseX: 3154, baseY: 4372, width: 32, height: 32 }}
        playing
        currentTick={10}
        onTick={onTick}
      >
        <TimeoutReplayClock />
      </Map>,
    );

    act(() => jest.advanceTimersByTime(300));
    rerender(
      <Map
        config={{
          interpolationEnabled: false,
          tickDuration: 550,
          debug: false,
        }}
        mapDefinition={{ baseX: 3154, baseY: 4372, width: 32, height: 32 }}
        playing
        currentTick={42}
        onTick={onTick}
      >
        <TimeoutReplayClock />
      </Map>,
    );

    act(() => jest.advanceTimersByTime(549));
    expect(onTick).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(1));
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('pauses while the document is hidden', () => {
    const onTick = jest.fn();
    const hidden = jest.spyOn(document, 'hidden', 'get');
    render(
      <Map
        config={{
          interpolationEnabled: false,
          tickDuration: 650,
          debug: false,
        }}
        mapDefinition={{ baseX: 3154, baseY: 4372, width: 32, height: 32 }}
        playing
        currentTick={18}
        onTick={onTick}
      >
        <TimeoutReplayClock />
      </Map>,
    );

    hidden.mockReturnValue(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => jest.advanceTimersByTime(5000));
    expect(onTick).not.toHaveBeenCalled();

    hidden.mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => jest.advanceTimersByTime(649));
    expect(onTick).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(1));
    expect(onTick).toHaveBeenCalledTimes(1);
  });
});
