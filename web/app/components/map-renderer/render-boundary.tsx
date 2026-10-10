'use client';

import { Component, ReactNode, Suspense } from 'react';

interface RenderErrorBoundaryProps {
  /** Placeholder rendered when the children cannot render. */
  fallback: ReactNode;
  children: ReactNode;
}

interface RenderErrorBoundaryState {
  hasError: boolean;
}

export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  state: RenderErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RenderErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/**
 * Wraps children so that both their loading state and render failures show
 * `fallback` instead of crashing. The same placeholder is shown whether the
 * children are still pending or have failed outright.
 */
export default function RenderBoundary({
  fallback,
  children,
}: RenderErrorBoundaryProps) {
  return (
    <RenderErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </RenderErrorBoundary>
  );
}
