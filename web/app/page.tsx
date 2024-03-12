import Image from 'next/image';

import styles from './styles.module.scss';
import CollapsiblePanel from './components/collapsible-panel';

export default function Home() {
  return (
    <div className={styles.home}>
      <div className={styles.homeInner}>
        <Image
          src="/tobdataegirl.png"
          alt="Tob Data Egirl waving"
          width={430}
          height={410}
          className={styles.home__Image}
        />
        <CollapsiblePanel
          panelTitle="Blert Dot Eye Oh"
          maxPanelHeight={9999}
          defaultExpanded={true}
          className={styles.homeOverview}
          disableExpansion={true}
          panelWidth={950}
        >
          <div className={styles.homeOverviewInner} style={{ padding: '20px' }}>
            <h2 style={{ fontSize: '26px', marginTop: '0' }}>
              Welcome to blert!
            </h2>
            <p style={{ fontSize: '20px' }}>
              <strong style={{ fontSize: '22px' }}>What is blert?</strong>
              <br />
              <br />
              Blert (name TBD) is a RuneLite plugin, data analysis pipeline, and
              web tool that we have been developing for several months now. It
              originally started as a plugin to track and visualize Theatre of
              Blood raid data but its scope has since expanded to encompass
              any-and-all endgame PvM content (of nontrivial difficulty) that
              exists in OSRS.
            </p>
            <p style={{ fontSize: '20px' }}>
              <strong style={{ fontSize: '22px' }}>Why?</strong>
              <br />
              <br />
              We believe that the OSRS PvM community is in need of a tool that
              can help players improve their performance and learn from their
              mistakes (or call out their friends mistakes...). Our long-term
              goal is to be the{' '}
              <a
                style={{ textDecoration: 'underline' }}
                href="https://wiseoldman.net/"
                target="_blank"
                rel="noreferrer noopener"
              >
                wiseoldman.net
              </a>{' '}
              equivalent but for PvM data analysis.
              <br />
              Our tool aims to fill the gap that exists in the OSRS
              high-level-community that is covered in other major MMOs - tools
              like{' '}
              <a
                style={{ textDecoration: 'underline' }}
                href="https://warcraftlogs.com/"
                target="_blank"
                rel="noreferrer noopener"
              >
                warcraftlogs.com
              </a>{' '}
              &{' '}
              <a
                style={{ textDecoration: 'underline' }}
                href="https://fflogs.com/"
                target="_blank"
                rel="noreferrer noopener"
              >
                fflogs.com
              </a>
              {'.'}
            </p>
            <p style={{ fontSize: '20px' }}>
              <strong style={{ fontSize: '22px' }}>Who made this thing?</strong>
              <br />
              <br />
              Contrary to popular opinion, the developers of Blert are Sacolyn
              (aka TobDataEgirl) and 715 (aka TobDataBoy) -- NOT CapsLock13
              😊... but we might have added some easter eggs pertaining to Caps
              since hes been a part of this journey.
            </p>
            <p style={{ fontSize: '20px' }}>
              <strong style={{ fontSize: '22px' }}>
                What content is supported so far?
              </strong>
              <br />
              <br />
              Our efforts so far have been focused on ToB. Our plugin
              infrastructure and data processing is set up to be generic enough
              to support any PvM content in the game.
            </p>
            <p style={{ fontSize: '20px' }}>
              <strong style={{ fontSize: '22px' }}>
                What content are you going to work on next?
              </strong>
              <br />
              <br />
              When the Fortis Colosseum comes out on March 20th we will likely
              shift to that as our primary focus. If we get additional
              contributors we will be able to support more content more quickly,
              consider lending a hand!
            </p>
            <p style={{ fontSize: '20px' }}>
              <strong style={{ fontSize: '22px' }}>Is it released yet?</strong>
              <br />
              <br />
              We will be submitting Blert for review by the RuneLite team in the
              coming weeks. We are currently in the process of finalizing v1 of
              the plugin :)
            </p>
            <p style={{ fontSize: '20px' }}>
              <strong style={{ fontSize: '22px' }}>Do you need help?</strong>
              <br />
              <br />
              Yes! Right now we are looking for two things primarily;
              <ol>
                <li>
                  <strong>Code contributors</strong>! If you know Java,
                  HTML/CSS/React or Next
                </li>
                <li>UX Feedback</li>
                <li>Feature requests</li>
              </ol>
              If youd like to help out or if you have any questions about our
              website or plugin, please reach us on our{' '}
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
        </CollapsiblePanel>
      </div>
    </div>
  );
}
