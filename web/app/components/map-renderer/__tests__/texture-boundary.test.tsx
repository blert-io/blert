/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';

import TextureBoundary from '../texture-boundary';

function LoadFailure(): never {
  throw new Error('texture failed to load');
}

function StillLoading(): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw new Promise<void>(() => {
    /* suspend loader throws a never-settling promise */
  });
}

describe('TextureBoundary', () => {
  it('renders its children once the texture has loaded', () => {
    render(
      <TextureBoundary fallback={<div>fallback</div>}>
        <div>loaded</div>
      </TextureBoundary>,
    );

    expect(screen.getByText('loaded')).toBeInTheDocument();
    expect(screen.queryByText('fallback')).not.toBeInTheDocument();
  });

  it('shows the fallback while the texture is still loading', () => {
    render(
      <TextureBoundary fallback={<div>fallback</div>}>
        <StillLoading />
      </TextureBoundary>,
    );

    expect(screen.getByText('fallback')).toBeInTheDocument();
  });

  it('shows the fallback instead of crashing when the texture fails to load', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {
      /* silence react error */
    });

    expect(() =>
      render(
        <TextureBoundary fallback={<div>fallback</div>}>
          <LoadFailure />
        </TextureBoundary>,
      ),
    ).not.toThrow();
    expect(screen.getByText('fallback')).toBeInTheDocument();

    consoleError.mockRestore();
  });
});
