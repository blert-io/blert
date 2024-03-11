'use client';

import { useState, useEffect } from 'react';
import CollapsiblePanel from '../../components/collapsible-panel';
import {
  PvMContent,
  PvMContentLogo,
} from '../../components/pvm-content-logo/pvm-content-logo';
import styles from './style.module.scss';
import Image from 'next/image';
import { RaidOverview, loadRecentRaidInformation } from '../../actions/raid';
import { RaidQuickDetails } from '../../components/raid-quick-details/raid-quick-details';
import Link from 'next/link';

export default function Page() {
  const [raids, setRaids] = useState<RaidOverview[]>([]);

  useEffect(() => {
    const getRaids = async () => {
      const raidResults = await loadRecentRaidInformation(5);
      setRaids(raidResults);
    };

    getRaids();
  }, []);

  let raidElements = raids.map((raid) => (
    <Link
      href={`/raids/tob/${raid._id}/overview`}
      key={`recent-raid-${raid._id}`}
    >
      <div className={styles.recentRaids}>
        <div className={styles.recentRaidsTeam}>
          <span style={{ fontWeight: 'bold' }}>Players: </span>
          {raid.party.join(', ')}
        </div>
        <RaidQuickDetails
          raidStatus={raid.status}
          raidDifficulty={raid.mode}
          totalRaidTicks={raid.totalRoomTicks}
          deaths={raid.totalDeaths}
          partySize={raid.party.length}
          startTime={raid.startTime}
          compactView={true}
        />
      </div>
    </Link>
  ));

  return (
    <>
      <PvMContentLogo
        pvmContent={PvMContent.TheatreOfBlood}
        height={350}
        width={623}
      />
      <CollapsiblePanel
        panelTitle="The Theatre Of Blood"
        maxPanelHeight={500}
        defaultExpanded={true}
        className={styles.tobOverview}
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
            <h3>Hello</h3>

            <p>
              Lorem ipsum dolor sit amet consectetur adipisicing elit. Molestias
              rem, cupiditate repellendus, consequatur animi, maiores
              necessitatibus sed voluptate doloribus quae minus fugiat? At
              obcaecati, harum quas veritatis porro quidem illo incidunt
              repellat consequuntur laudantium? Saepe non tempore commodi
              maiores sequi possimus praesentium iure! Consequuntur possimus
              voluptas, neque fugit ut consectetur.
            </p>

            <p>
              Lorem ipsum dolor sit amet consectetur, adipisicing elit. Sequi
              nisi quam facilis ipsum modi hic rerum rem! Dolorum incidunt
              cumque libero nisi ratione non ducimus facere, blanditiis labore
              quis at sequi officiis molestias. Officia minima temporibus
              laudantium non quia praesentium ratione mollitia maxime, similique
              omnis odio expedita asperiores dolores quod quasi placeat itaque
              harum aliquam laborum sed illo atque! Accusantium excepturi,
              itaque sint ipsum veritatis ea dolorem tempora incidunt temporibus
              accusamus in, ratione eligendi nesciunt!
            </p>

            <p>
              Lorem ipsum dolor sit amet consectetur adipisicing elit. Dolor
              adipisci placeat officiis libero ex? Magni dicta iste fugiat
              cupiditate porro minus quod, qui animi!
            </p>
          </div>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel
        panelTitle="Recently Recorded Raids"
        maxPanelHeight={800}
        defaultExpanded={true}
        className={styles.tobRecentRecordings}
      >
        {raidElements}
      </CollapsiblePanel>
    </>
  );
}
