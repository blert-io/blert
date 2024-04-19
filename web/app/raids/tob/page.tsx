import { ChallengeType } from '@blert/common';
import { Metadata } from 'next';
import Image from 'next/image';

import PvMContentLogo, { PvMContent } from '../../components/pvm-content-logo';
import CollapsiblePanel from '../../components/collapsible-panel';
import ChallengeHistory from '../../components/challenge-history';

import styles from './style.module.scss';

export default async function Page() {
  return (
    <>
      <PvMContentLogo
        pvmContent={PvMContent.TheatreOfBlood}
        height={350}
        width={623}
      />
      <CollapsiblePanel
        panelTitle="The Theatre Of Blood"
        maxPanelHeight={2000}
        defaultExpanded={true}
        disableExpansion={true}
      >
        <div className={styles.tobOverviewInner}>
          <Image
            className={styles.raid__Logo}
            src="/tobdataegirl.png"
            alt="ToB Preview"
            height={300}
            width={300}
            style={{ objectFit: 'cover' }}
          />

          <div className={styles.textGreeting}>
            <p style={{ fontSize: '26px' }}>
              Welcome to the Theatre of Blood data tracker!
              <br />
              <br />
              Feel free to explore some of the recently recorded raids, or
              search for your (or a friend&apos;s) RSN to see some player stats.
              <br />
              <br />
              If you have any questions please feel free to reach out to us on
              our{' '}
              <a
                href="https://discord.gg/c5Hgv3NnYe"
                target="_blank"
                rel="noreferrer noopener"
                style={{ textDecoration: 'underline' }}
              >
                Discord Server
              </a>
              .
            </p>
          </div>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel
        panelTitle="Recently Recorded Raids"
        maxPanelHeight={2000}
        defaultExpanded={true}
      >
        <ChallengeHistory type={ChallengeType.TOB} count={5} />
      </CollapsiblePanel>
    </>
  );
}

export const metadata: Metadata = {
  title: 'Theatre of Blood',
};

export const dynamic = 'force-dynamic';
