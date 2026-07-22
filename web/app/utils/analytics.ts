'use client';

type EventData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: EventData) => void;
    };
  }
}

/**
 * Records a custom analytics event, if enabled.
 */
export function trackEvent(event: string, data?: EventData): void {
  window.umami?.track(event, data);
}
