import { Metadata } from 'next';
import Image from 'next/image';

import CollapsiblePanel from '../../components/collapsible-panel';
import PvMContentLogo, { PvMContent } from '../../components/pvm-content-logo';

import styles from './style.module.scss';

export default function Page() {
  return (
    <>
      <PvMContentLogo
        pvmContent={PvMContent.ChambersOfXeric}
        height={482}
        width={623}
      />
      <CollapsiblePanel
        panelTitle="The Chambers of Xeric"
        maxPanelHeight={2000}
        defaultExpanded={true}
        disableExpansion={true}
      >
        <div className={styles.coxOverviewInner}>
          <Image
            className={styles.raid__Logo}
            src="/tobdataegirl_cox.png"
            alt="ToB Preview"
            height={300}
            width={300}
            style={{ objectFit: 'cover' }}
          />

          <div className={styles.textGreeting}>
            <p
              style={{
                fontSize: '26px',
                paddingTop: '50px',
              }}
            >
              We are adding raid recording support for the Chambers of Xeric
              raid soon! Stay tuned for updates. If you have any questions,
              would like to help out, provide feedback, or just want to chat,
              feel free to join our{' '}
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
              <a href="/" style={{ textDecoration: 'underline' }}>
                FAQ
              </a>
              !
            </p>
          </div>
        </div>
      </CollapsiblePanel>
    </>
  );
}

export const metadata: Metadata = {
  title: 'Chambers of Xeric',
};
