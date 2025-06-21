'use client';

import { Suspense, useState } from 'react';

import styles from './style.module.scss';

import {
  BlertMemes,
  DEFAULT_MEMES,
  MemeContext,
  MemeContextUpdater,
} from './meme-context';
import Image from 'next/image';

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
        {memes.cursed && (
          <div className={styles.rat}>
            <Image
              alt="Rat"
              src="/images/rat-right.png"
              className={styles.right}
              width={100}
              height={100}
            />
            <Image
              alt="Rat"
              src="/images/rat-left.png"
              className={styles.left}
              width={100}
              height={100}
            />
          </div>
        )}
        {memes.tenWTwoQ && (
          <div className={styles.tenWTwoQ}>
            <Image
              alt="WWWWWWWWWWQQ"
              src="/images/wwwwwwwwwwqq.gif"
              width={498}
              height={282}
            />
          </div>
        )}
        {props.children}
      </MemeContext.Provider>
    </>
  );
}
