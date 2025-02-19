import Image from 'next/image';
import Link from 'next/link';

import CollapsiblePanel from './components/collapsible-panel';

import styles from './home.module.scss';

export default function Home() {
  return (
    <div className={styles.home}>
      <div className={styles.homeInner}>
        <div className={styles.image}>
          <Image
            src="/tobdataegirl.png"
            alt="Tob Data Egirl waving"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>

        <CollapsiblePanel
          panelTitle="Status Updates"
          maxPanelHeight={9999}
          defaultExpanded
          className={styles.homeOverview}
          disableExpansion
        >
          <div className={styles.homeOverviewInner}>
            <div className={styles.statusSection}>
              <div className={styles.statusCard}>
                <h3 className={`${styles.statusHeading} ${styles.error}`}>
                  ⚠️ Service Alert
                </h3>
                <span className={styles.statusTimestamp}>
                  Last updated: Feb 19, 2025 01:00 UTC
                </span>
                <ul className={styles.statusList}>
                  <li>
                    A recent RuneScape update has changed when NPCs and player
                    events are sent to clients, which has affected how Blert
                    records data.
                  </li>
                  <li>
                    A fix has been applied for participants in challenges.
                    However, spectators in the Theatre of Blood will still
                    experience issues.
                  </li>
                  <li>
                    As a result,{' '}
                    <strong>
                      recording challenges as a spectator is temporarily
                      disabled.
                    </strong>
                  </li>
                </ul>
              </div>

              {/* <div className={styles.statusCard}>
                <h3 className={`${styles.statusHeading} ${styles.success}`}>
                  🎉 Latest Updates
                </h3>
                <span className={styles.statusTimestamp}>
                  Last updated: Feb 18, 2025 12:00 UTC
                </span>
                <ul className={styles.statusList}>
                  <li>Lorem ipsum dolor sit amet</li>
                </ul>
              </div> */}

              {/* <div className={styles.statusCard}>
                <h3 className={`${styles.statusHeading} ${styles.info}`}>
                  🚀 Coming Soon
                </h3>
                <span className={styles.statusTimestamp}>
                  Last updated: Feb 17, 2025 09:15 UTC
                </span>
                <ul className={styles.statusList}>
                  <li>Lorem ipsum dolor sit amet</li>
                </ul>
              </div> */}
            </div>
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel
          panelTitle="Blert Dot Eye Oh"
          maxPanelHeight={9999}
          defaultExpanded={true}
          className={styles.homeOverview}
          disableExpansion={true}
        >
          <div className={styles.homeOverviewInner}>
            <h2 className={styles.welcomeTitle}>Welcome to blert!</h2>
            <p className={styles.contentText}>
              <strong className={styles.sectionTitle}>What is blert?</strong>
              <br />
              <br />
              Blert is a RuneLite plugin, data analysis pipeline, and web tool
              that we have been developing for several months now. It originally
              started as a plugin to track and visualize Theatre of Blood raid
              data but its scope has since expanded to encompass any-and-all
              endgame PvM content (of nontrivial difficulty) that exists in
              OSRS.
            </p>
            <p className={styles.contentText}>
              <strong className={styles.sectionTitle}>Why?</strong>
              <br />
              <br />
              We believe that the OSRS PvM community is in need of a tool that
              can help players improve their performance and learn from their
              mistakes (or call out their friends&apos; mistakes...). Our
              long-term goal is to be the{' '}
              <Link
                className={styles.link}
                href="https://wiseoldman.net/"
                target="_blank"
                rel="noreferrer noopener"
              >
                wiseoldman.net
              </Link>{' '}
              equivalent but for PvM data analysis.
              <br />
              Our tool aims to fill the gap that exists in the OSRS
              high-level-community that is covered in other major MMOs - tools
              like{' '}
              <Link
                className={styles.link}
                href="https://warcraftlogs.com/"
                target="_blank"
                rel="noreferrer noopener"
              >
                warcraftlogs.com
              </Link>{' '}
              &{' '}
              <Link
                className={styles.link}
                href="https://fflogs.com/"
                target="_blank"
                rel="noreferrer noopener"
              >
                fflogs.com
              </Link>{' '}
              {'.'}
            </p>
            <p className={styles.contentText}>
              <strong className={styles.sectionTitle}>
                Who made this thing?
              </strong>
              <br />
              <br />
              Contrary to popular opinion, the developers of Blert are Sacolyn
              (aka TobDataEgirl) and 715 (aka TobDataBoy) -- NOT Caps Lock13
              😊... but we might have added some easter eggs pertaining to Caps
              since hes been a part of this journey.
            </p>
            <p className={styles.contentText}>
              <strong className={styles.sectionTitle}>
                What content is supported so far?
              </strong>
              <br />
              <br />
              Our efforts so far have been focused on ToB. Our plugin
              infrastructure and data processing is set up to be generic enough
              to support any PvM content in the game.
            </p>
            <p className={styles.contentText}>
              <strong className={styles.sectionTitle}>
                What content are you going to work on next?
              </strong>
              <br />
              <br />
              When the Fortis Colosseum comes out on March 20th we will likely
              shift to that as our primary focus. If we get additional
              contributors we will be able to support more content more quickly,
              consider lending a hand!
            </p>
            <p className={styles.contentText}>
              <strong className={styles.sectionTitle}>
                Is it released yet?
              </strong>
              <br />
              <br />
              We will be submitting Blert for review by the RuneLite team in the
              coming weeks. We are currently in the process of finalizing v1 of
              the plugin :)
            </p>
            <div className={styles.helpSection}>
              <strong className={styles.helpTitle}>Do you need help?</strong>
              <br />
              <br />
              Yes! Right now we are looking for three things primarily;
              <ol className={styles.helpList}>
                <li>
                  <strong>Code contributors</strong>! If you know Java,
                  HTML/CSS/React or Next
                </li>
                <li>UX Feedback</li>
                <li>Feature requests</li>
              </ol>
              If you&apos;d like to help out or if you have any questions about
              our website or plugin, please reach us on our{' '}
              <a
                className={styles.helpLink}
                href="https://discord.gg/c5Hgv3NnYe"
                target="_blank"
                rel="noreferrer noopener"
              >
                Discord Server
              </a>
              !
            </div>
          </div>
        </CollapsiblePanel>
      </div>
    </div>
  );
}
