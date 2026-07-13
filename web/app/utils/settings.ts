/**
 * localStorage key prefix for persisted user settings.
 *
 * This must in a plain (not 'use client`) module because it is shared by
 * both client code (`user-settings`, `settings-provider`) and server code (the
 * pre-paint `theme-script`, rendered by the root layout).
 */
export const SETTINGS_KEY_PREFIX = 'blert-setting:';
