'use client';

import { useSearchParams } from 'next/navigation';
import { BlertMemes, MemeContext } from './meme-context';

type RaidLayoutProps = {
  children: React.ReactNode;
};

export default function RaidLayout(props: RaidLayoutProps) {
  const params = useSearchParams();

  const memesToApply = params.get('memes')?.split(',') ?? [];

  let memes: BlertMemes = {
    inventoryTags: false,
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
