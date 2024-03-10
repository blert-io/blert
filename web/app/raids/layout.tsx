'use client';

import { useSearchParams } from 'next/navigation';
import { BlertMemes, MemeContext } from './meme-context';
import { useEffect, useState } from 'react';

type RaidLayoutProps = {
  children: React.ReactNode;
};

export default function RaidLayout(props: RaidLayoutProps) {
  const params = useSearchParams();
  const [capsLockPresses, setCapsLockPresses] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      setCapsLockPresses((p) => (e.key === 'CapsLock' ? p + 1 : 0));
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const memesToApply = params.get('memes')?.split(',') ?? [];

  let memes: BlertMemes = {
    inventoryTags: false,
    capsLock: capsLockPresses >= 13,
  };

  for (const meme of memesToApply) {
    switch (meme) {
      case 'invtags':
      case 'tags':
        memes.inventoryTags = true;
        break;
    }
  }

  return (
    <MemeContext.Provider value={memes}>{props.children}</MemeContext.Provider>
  );
}
