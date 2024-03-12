import CollapsiblePanel from '../../components/collapsible-panel';
import {
  PvMContent,
  PvMContentLogo,
} from '../../components/pvm-content-logo/pvm-content-logo';
import styles from './style.module.scss';
import Image from 'next/image';

export default function Page() {
  return (
    <>
      <PvMContentLogo
        pvmContent={PvMContent.Colosseum}
        height={350}
        width={623}
      />
      <CollapsiblePanel
        panelTitle="The Fortis Colosseum"
        maxPanelHeight={500}
        defaultExpanded={true}
        className={styles.fortisOverview}
        disableExpansion={true}
      >
        <div className={styles.fortisOverviewInner}>
          <Image
            className={styles.raid__Logo}
            src="/fortis_preview.jpg"
            alt="Fortis Preview"
            height={300}
            width={300}
            style={{ objectFit: 'cover' }}
          />

          <div className={styles.textGreeting}>
            <p
              style={{
                fontSize: '26px',
                paddingTop: '35px',
              }}
            >
              We are as excited as you are to dive into the Fortis Colosseum on
              March 20th. We will be recording the data necessary to enable
              Fortis Colosseum analysis and visualizations on Blert while we do
              the content ourselves for the first time. Stay tuned for updates!
              <br />
              <br />
              If youd like to help out, have any feedback, or just want to chat,
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
            </p>
          </div>
        </div>
      </CollapsiblePanel>
    </>
  );
}
