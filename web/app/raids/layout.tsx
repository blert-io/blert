'use client';

import { Suspense, useState } from 'react';

import {
  BlertMemes,
  DEFAULT_MEMES,
  MemeContext,
  MemeContextUpdater,
} from './meme-context';

type RaidLayoutProps = {
  children: React.ReactNode;
};

export default function RaidLayout(props: RaidLayoutProps) {
  const [memes, setMemes] = useState<BlertMemes>(DEFAULT_MEMES);

  return (
    <>
      <Suspense>
        <MemeContextUpdater setMemes={setMemes} />
      </Suspense>
      <MemeContext.Provider value={memes}>
        {props.children}
      </MemeContext.Provider>
    </>
  );
}
