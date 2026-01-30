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
          <div className={styles.rat} aria-hidden="true">
            <div className={styles.ratTrack}>
              <div className={styles.ratBounce}>
                <div className={styles.ratSprite}>
                  <Image
                    alt=""
                    src="/images/rat-right.png"
                    className={styles.right}
                    width={100}
                    height={100}
                  />
                  <Image
                    alt=""
                    src="/images/rat-left.png"
                    className={styles.left}
                    width={100}
                    height={100}
                  />
                </div>
              </div>
            </div>
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
