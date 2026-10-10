import { ResolvingMetadata } from 'next';
import Image from 'next/image';

import Card from '@/components/card';

import ReleaseCountdown from './release-countdown';

import styles from './style.module.scss';

export default function Page() {
  return (
    <div className={styles.tfaPage}>
      <Card primary className={styles.hero}>
        <Image
          className={styles.logo}
          src="/images/tfa.webp"
          alt="The Fractured Archive"
          width={360}
          height={277}
          priority
        />
        <ReleaseCountdown />
      </Card>
    </div>
  );
}

const TITLE = 'The Fractured Archive';
const DESCRIPTION =
  'The Fractured Archive releases October 20. Blert recording support will arrive some time after release.';
const IMAGES = [
  { url: '/images/tfa.webp', width: 1200, height: 923, alt: TITLE },
];

export async function generateMetadata(
  _props: object,
  parent: ResolvingMetadata,
) {
  const metadata = await parent;

  return {
    title: TITLE,
    description: DESCRIPTION,
    openGraph: {
      ...metadata.openGraph,
      title: TITLE,
      description: DESCRIPTION,
      url: '/raids/tfa',
      images: IMAGES,
    },
    twitter: {
      ...metadata.twitter,
      card: 'summary_large_image',
      title: TITLE,
      description: DESCRIPTION,
      images: IMAGES,
    },
  };
}
