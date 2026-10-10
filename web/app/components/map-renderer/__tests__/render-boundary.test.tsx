/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';

import RenderBoundary from '../render-boundary';

function LoadFailure(): never {
  throw new Error('failed to render');
}

function StillLoading(): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw new Promise<void>(() => {
    /* suspend loader throws a never-settling promise */
  });
}

describe('RenderBoundary', () => {
  it('renders its children once they have loaded', () => {
    render(
      <RenderBoundary fallback={<div>fallback</div>}>
        <div>loaded</div>
      </RenderBoundary>,
    );

    expect(screen.getByText('loaded')).toBeInTheDocument();
    expect(screen.queryByText('fallback')).not.toBeInTheDocument();
  });

  it('shows the fallback while the children are still loading', () => {
    render(
      <RenderBoundary fallback={<div>fallback</div>}>
        <StillLoading />
      </RenderBoundary>,
    );

    expect(screen.getByText('fallback')).toBeInTheDocument();
  });

  it('shows the fallback instead of crashing when the children fail to render', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {
      /* silence react error */
    });

    expect(() =>
      render(
        <RenderBoundary fallback={<div>fallback</div>}>
          <LoadFailure />
        </RenderBoundary>,
      ),
    ).not.toThrow();
    expect(screen.getByText('fallback')).toBeInTheDocument();

    consoleError.mockRestore();
  });
});
