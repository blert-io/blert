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
        pvmContent={PvMContent.Inferno}
        height={350}
        width={593}
      />
      <CollapsiblePanel
        panelTitle="The Inferno"
        maxPanelHeight={500}
        defaultExpanded={true}
        className={styles.infernoOverview}
        disableExpansion={true}
      >
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
            <p
              style={{
                fontSize: '26px',
                paddingTop: '40px',
              }}
            >
              Here on the Blert team, we love zuk. We are aiming to add Inferno
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
