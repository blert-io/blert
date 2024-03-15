import Image from 'next/image';

import CollapsiblePanel from '../../components/collapsible-panel';
import PvMContentLogo, { PvMContent } from '../../components/pvm-content-logo';

import styles from './style.module.scss';

export default function Page() {
  return (
    <>
      <PvMContentLogo
        pvmContent={PvMContent.TombsOfAmascut}
        height={350}
        width={545}
      />
      <CollapsiblePanel
        panelTitle="The Tombs of Amascut"
        maxPanelHeight={2000}
        defaultExpanded={true}
        disableExpansion={true}
      >
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
            <p style={{ fontSize: '26px', padding: '0.5em 0' }}>
              We are adding raid recording support for the Tombs of Amascut raid
              soon! Stay tuned for updates. If you have any questions or, would
              like to help out, provide feedback, or just want to chat, feel
              free to join our{' '}
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
