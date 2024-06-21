import Image from 'next/image';
import Link from 'next/link';

import guideStyles from '../style.module.scss';
import styles from './style.module.scss';

export default function TobGuides() {
  return (
    <div className={guideStyles.guides}>
      <div className={`${guideStyles.guidePanel} ${guideStyles.guidesHeader}`}>
        <h1>Theatre of Blood Guides</h1>
        <p>
          <em>
            Our selection of guides is currently limited, but we are working
            hard to expand our collection. Check back soon!
          </em>
        </p>
      </div>
      <div className={styles.group}>
        <div className={guideStyles.guidePanel}>
          <h2>General</h2>
          <Link href="/guides/tob/plugins">Plugins guide</Link>
        </div>
      </div>
      <div className={styles.group}>
        <div className={guideStyles.guidePanel}>
          <h2>The Nylocas</h2>
          <Image
            src="/nyloking.webp"
            alt="Nylocas"
            height={200}
            width={200}
            style={{ objectFit: 'contain' }}
          />
          <h3>Nylocas waves</h3>
          <Link href="/guides/tob/nylocas/trio">Trio Waves Guide</Link>
        </div>
      </div>
    </div>
  );
}

export const metadata = {
  title: 'Theatre of Blood Guides',
  description: 'Browse top-tier guides for the Theatre of Blood.',
};
