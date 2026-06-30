'use client';

import { Component, ReactNode, Suspense } from 'react';

interface TextureBoundaryProps {
  /** Placeholder rendered while the texture loads or if loading fails. */
  fallback: ReactNode;
  children: ReactNode;
}

interface TextureErrorBoundaryState {
  hasError: boolean;
}

class TextureErrorBoundary extends Component<
  TextureBoundaryProps,
  TextureErrorBoundaryState
> {
  state: TextureErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): TextureErrorBoundaryState {
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
 * Wraps a texture-loading mesh so that both the loading state and load failures
 * render `fallback` instead of crashing. The same placeholder is shown whether
 * the texture is still pending or has failed outright.
 */
export default function TextureBoundary({
  fallback,
  children,
}: TextureBoundaryProps) {
  return (
    <TextureErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </TextureErrorBoundary>
  );
}
