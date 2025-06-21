import { ChallengeType } from '@blert/common';
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';

import Card from '@/components/card';
import { challengeLogo } from '@/logo';

import styles from './style.module.scss';

export default function Page() {
  return (
    <>
      <Card primary className={styles.logo}>
        <Image
          src={challengeLogo(ChallengeType.INFERNO)}
          alt="The Inferno"
          width={160}
          height={100}
          style={{ objectFit: 'contain' }}
        />
      </Card>
      <Card header={{ title: 'The Inferno' }}>
        <div className={styles.infernoOverviewInner}>
          <Image
            className={styles.raid__Logo}
            src="/tobdataegirl_inferno.png"
            alt="Inferno Preview"
            height={300}
            width={300}
            style={{ objectFit: 'cover' }}
          />

          <div className={styles.textGreeting}>
            <p style={{ fontSize: '24px' }}>
              Here on the Blert team, we love Zuk. We are aiming to add Inferno
              support to Blert in the very near future. Stay tuned for updates!
              <br />
              <br />
              If you have any question, would like to help out, have any
              feedback, or just want to chat, feel free to join our{' '}
              <a
                href="https://discord.gg/c5Hgv3NnYe"
                target="_blank"
                rel="noreferrer noopener"
                style={{ textDecoration: 'underline' }}
              >
                Discord Server
              </a>
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
  title: 'The Inferno',
};
