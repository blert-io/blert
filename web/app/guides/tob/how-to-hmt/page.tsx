import Image from 'next/image';

// This is a meme page, not the actual HMT guide.

import styles from './style.module.scss';

export default function Page() {
  return (
    <div className={styles.hmt}>
      <Image
        src="/logo_tob.webp"
        alt="Theatre of Blood"
        height={200}
        width={300}
        style={{ objectFit: 'contain' }}
      />
      <h1>How to HMT</h1>
      <p>Don&apos;t.</p>
    </div>
  );
}

export const metadata = {
  title: 'Hard Mode Theatre of Blood Guide',
  description:
    'The ultimate, most comprehensive guide to conquering Hard Mode in the Theatre of Blood, targeted at only the most elite PvMers.',
};
