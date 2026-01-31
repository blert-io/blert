import { sendGAEvent } from '@next/third-parties/google';
import { useSearchParams } from 'next/navigation';
import {
  Dispatch,
  SetStateAction,
  createContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export type BlertMemes = {
  inventoryTags: boolean;
  capsLock: boolean;
  cursed: boolean;
  tenWTwoQ: boolean;
};

export const DEFAULT_MEMES: BlertMemes = {
  inventoryTags: false,
  capsLock: false,
  cursed: false,
  tenWTwoQ: false,
};

export const MemeContext = createContext<BlertMemes>(DEFAULT_MEMES);

type MemeContextUpdaterProps = {
  setMemes: Dispatch<SetStateAction<BlertMemes>>;
};

const TEN_W_TWO_Q = 'wwwwwwwwwwqq';

export function MemeContextUpdater({ setMemes }: MemeContextUpdaterProps) {
  const params = useSearchParams();
  const [capsLockPresses, setCapsLockPresses] = useState(0);
  const [wqIndex, setWqIndex] = useState(0);

  // Track whether we've already sent analytics for each meme activation.
  const analyticsRef = useRef({
    capsLock: false,
    tenWTwoQ: false,
    cursed: false,
    inventoryTags: false,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      setWqIndex((i) => {
        if (i >= TEN_W_TWO_Q.length) {
          return e.key === 'Escape' ? 0 : i;
        }
        return e.key === TEN_W_TWO_Q[i] ? i + 1 : 0;
      });
      setCapsLockPresses((p) => (e.key === 'CapsLock' ? p + 1 : 0));
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const thirteenCapsLockPresses = capsLockPresses >= 13;
  const tenWTwoQ = wqIndex >= TEN_W_TWO_Q.length;
  const memesParam = params.get('memes');

  useEffect(() => {
    const memesToApply = memesParam?.split(',') ?? [];

    const memes: BlertMemes = {
      inventoryTags: false,
      capsLock: thirteenCapsLockPresses,
      cursed: Math.random() < 0.005,
      tenWTwoQ,
    };

    for (const meme of memesToApply) {
      switch (meme) {
        case 'invtags':
        case 'tags':
          memes.inventoryTags = true;
          break;
        case 'cursed':
          memes.cursed = true;
          break;
      }
    }

    // Track meme activations.
    if (memes.capsLock && !analyticsRef.current.capsLock) {
      analyticsRef.current.capsLock = true;
      sendGAEvent('event', 'meme_activated', { meme: 'capslock13' });
    }
    if (memes.tenWTwoQ && !analyticsRef.current.tenWTwoQ) {
      analyticsRef.current.tenWTwoQ = true;
      sendGAEvent('event', 'meme_activated', { meme: 'wwwwwwwwwwqq' });
    }
    if (memes.cursed && !analyticsRef.current.cursed) {
      analyticsRef.current.cursed = true;
      sendGAEvent('event', 'meme_activated', {
        meme: 'rat',
        trigger: memesToApply.includes('cursed') ? 'url' : 'random',
      });
    }
    if (memes.inventoryTags && !analyticsRef.current.inventoryTags) {
      analyticsRef.current.inventoryTags = true;
      sendGAEvent('event', 'meme_activated', { meme: 'inventory_tags' });
    }

    setMemes(memes);
  }, [memesParam, thirteenCapsLockPresses, tenWTwoQ, setMemes]);

  return null;
}
