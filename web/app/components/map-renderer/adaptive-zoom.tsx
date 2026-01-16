'use client';

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { MapControls as MapControlsImpl } from 'three-stdlib';

import { useReplayContext } from './replay-context';

/**
 * Calculates the appropriate zoom level to maintain the same visual scale
 * when the container size changes.
 */
function calculateAdaptiveZoom(
  containerWidth: number,
  containerHeight: number,
  referenceWidth: number,
  referenceHeight: number,
  baseZoom: number,
): number {
  if (containerWidth === 0 || containerHeight === 0) {
    return baseZoom;
  }

  if (referenceWidth === 0 || referenceHeight === 0) {
    return baseZoom;
  }

  const widthScale = containerWidth / referenceWidth;
  const heightScale = containerHeight / referenceHeight;
  const scaleFactor = Math.min(widthScale, heightScale);

  const newZoom = baseZoom * scaleFactor;

  return Math.max(10, Math.min(150, newZoom));
}

/**
 * Component that adaptively adjusts camera zoom based on container size.
 * Must be rendered inside a Canvas component.
 */
export function AdaptiveZoomController({
  controlsRef,
}: {
  controlsRef: React.RefObject<MapControlsImpl | null>;
}) {
  const { camera } = useThree();
  const { mapDefinition, referenceWidth, referenceHeight, isFullscreen } =
    useReplayContext();
  const containerRef = useRef<HTMLElement | null>(null);
  const baseZoomValue = mapDefinition.initialZoom ?? 20;

  const refWidth = referenceWidth ?? 704;
  const refHeight = referenceHeight ?? 604;

  useEffect(() => {
    // In fullscreen mode, set zoom0 to base zoom initially and skip adaptive zoom
    // The reset function will handle using base zoom on reset
    if (isFullscreen) {
      if (controlsRef.current) {
        controlsRef.current.zoom0 = baseZoomValue;
      }
      // Don't run adaptive zoom logic in fullscreen
      return;
    }

    const container = document.querySelector('[data-camera-reset-container]');
    if (!container || !(container instanceof HTMLElement)) {
      return;
    }

    containerRef.current = container;

    const updateZoom = () => {
      if (
        !containerRef.current ||
        !camera ||
        camera.type !== 'OrthographicCamera'
      ) {
        return;
      }

      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;

      if (containerWidth === 0 || containerHeight === 0) {
        return;
      }

      const newZoom = calculateAdaptiveZoom(
        containerWidth,
        containerHeight,
        refWidth,
        refHeight,
        baseZoomValue,
      );

      if (camera.type === 'OrthographicCamera') {
        camera.zoom = newZoom;
        camera.updateProjectionMatrix();
      }

      if (controlsRef.current) {
        controlsRef.current.zoom0 = newZoom;
      }
    };

    const timeoutId = setTimeout(updateZoom, 0);

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(updateZoom);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [camera, baseZoomValue, refWidth, refHeight, controlsRef, isFullscreen]);

  return null;
}
