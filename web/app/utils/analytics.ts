'use client';

type EventData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: EventData) => void;
    };
  }
}

const FLUSH_INTERVAL_MS = 500;
const MAX_FLUSH_ATTEMPTS = 20;

let pendingEvents: { event: string; data?: EventData }[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushAttempts = 0;

function stopFlushing(): void {
  if (flushTimer !== null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  pendingEvents = [];
}

function tryFlush(): void {
  if (window.umami === undefined) {
    flushAttempts++;
    if (flushAttempts >= MAX_FLUSH_ATTEMPTS) {
      stopFlushing();
    }
    return;
  }

  for (const { event, data } of pendingEvents) {
    window.umami.track(event, data);
  }
  stopFlushing();
}

/**
 * Records a custom analytics event, if enabled.
 */
export function trackEvent(event: string, data?: EventData): void {
  if (window.umami !== undefined) {
    window.umami.track(event, data);
    return;
  }

  // The tracker script loads asynchronously, so events fired early in the
  // page lifecycle are queued until it becomes available.
  pendingEvents.push({ event, data });
  if (flushTimer === null) {
    flushAttempts = 0;
    flushTimer = setInterval(tryFlush, FLUSH_INTERVAL_MS);
  }
}
