import { useEffect, useState } from 'react';

/** A modifier key, identified by its KeyboardEvent `key` value. */
export type ModifierKey = 'Alt' | 'Control' | 'Meta' | 'Shift';

/**
 * Tracks whether a modifier key is currently held down.
 *
 * The held state is reset on window blur to handle switching to a different
 * window before the `keyup` is delivered.
 *
 * @param key The modifier key to track.
 * @param enabled If `false`, key presses are ignored, so the state never
 *   transitions to true. A previously held state is maintained and still
 *   cleared by `keyup`/`blur`.
 * @returns Whether the modifier key is currently held.
 */
export function useModifierKey(
  key: ModifierKey,
  enabled: boolean = true,
): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (enabled && e.key === key) {
        setHeld(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === key) {
        setHeld(false);
      }
    };

    const handleBlur = () => {
      setHeld(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [key, enabled]);

  return held;
}
