import { useSearchParams } from 'next/navigation';
import {
  Dispatch,
  SetStateAction,
  createContext,
  useEffect,
  useState,
} from 'react';

export type BlertMemes = {
  inventoryTags: boolean;
  capsLock: boolean;
};

export const DEFAULT_MEMES: BlertMemes = {
  inventoryTags: false,
  capsLock: false,
};

export const MemeContext = createContext<BlertMemes>(DEFAULT_MEMES);

type MemeContextUpdaterProps = {
  setMemes: Dispatch<SetStateAction<BlertMemes>>;
};

export function MemeContextUpdater({ setMemes }: MemeContextUpdaterProps) {
  const params = useSearchParams();
  const [capsLockPresses, setCapsLockPresses] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      setCapsLockPresses((p) => (e.key === 'CapsLock' ? p + 1 : 0));
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const thirteenCapsLockPresses = capsLockPresses >= 13;
  const memesParam = params.get('memes');

  useEffect(() => {
    const memesToApply = memesParam?.split(',') ?? [];

    let memes: BlertMemes = {
      inventoryTags: false,
      capsLock: thirteenCapsLockPresses,
    };

    for (const meme of memesToApply) {
      switch (meme) {
        case 'invtags':
        case 'tags':
          memes.inventoryTags = true;
          break;
      }
    }

    setMemes(memes);
  }, [memesParam, thirteenCapsLockPresses, setMemes]);

  return null;
}
