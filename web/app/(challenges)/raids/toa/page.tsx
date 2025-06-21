import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import Card from '@/components/card';

import styles from './style.module.scss';
import { challengeLogo } from '@/logo';
import { ChallengeType } from '@blert/common';

export default function Page() {
  return (
    <>
      <Card primary className={styles.logo}>
        <Image
          src={challengeLogo(ChallengeType.TOA)}
          alt="The Tombs of Amascut"
          width={160}
          height={100}
          style={{ objectFit: 'contain' }}
        />
      </Card>
      <Card header={{ title: 'The Tombs of Amascut' }}>
        <div className={styles.toaOverviewInner}>
          <Image
            className={styles.raid__Logo}
            src="/tobdataegirl_toa.png"
            alt="TOA Preview"
            height={300}
            width={300}
            style={{ objectFit: 'cover' }}
          />

          <div className={styles.textGreeting}>
            <p style={{ fontSize: '24px', padding: '0.5em 0' }}>
              We are adding raid recording support for the Tombs of Amascut raid
              soon! Stay tuned for updates. If you have any questions or, would
              like to help out, provide feedback, or just want to chat, feel
              free to join our{' '}
              <Link
                href="https://discord.gg/c5Hgv3NnYe"
                target="_blank"
                rel="noreferrer noopener"
                style={{ textDecoration: 'underline' }}
              >
                Discord Server
              </Link>
              !
              <br />
              <br />
              Also, read our{' '}
              <Link href="/" style={{ textDecoration: 'underline' }}>
                FAQ
              </Link>
              !
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}

export const metadata: Metadata = {
  title: 'Tombs of Amascut',
  description: 'The Tombs of Amascut raid is coming soon!',
};
