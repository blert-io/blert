'use client';

import { useEffect, useState } from 'react';

import {
  PlayerWithStats,
  RaidOverview,
  loadPlayerWithStats,
  loadRecentRaidInformation,
} from '../../actions/raid';
import CollapsiblePanel from '../../components/collapsible-panel';
import RaidHistory from '../../components/raid-history';
import Statistic from '../../components/statistic';
import Image from 'next/image';

import styles from './style.module.scss';
import { PrimaryMeleeGear } from '@blert/common';

type PlayerPageProps = {
  params: { username: string };
};

export default function Player(props: PlayerPageProps) {
  const username = decodeURIComponent(props.params.username);

  const [loading, setLoading] = useState(true);
  const [player, setPlayer] = useState<PlayerWithStats | null>(null);
  const [raids, setRaids] = useState<RaidOverview[]>([]);

  useEffect(() => {
    const loadPlayer = async () => {
      setLoading(true);
      const [player, raids] = await Promise.all([
        loadPlayerWithStats(username),
        loadRecentRaidInformation(5, username),
      ]);
      setLoading(false);
      setPlayer(player);
      setRaids(raids);
    };
    loadPlayer();
  }, [username]);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (player === null) {
    // TODO(sam): player 404 page
    return <div>Player {username} not found</div>;
  }

  const stats = player.stats;

  let pIndex;
  let playersPrimaryMeleeGear;
  if (raids.length > 0) {
    pIndex = raids[0].party.findIndex((p) => p === username);
    playersPrimaryMeleeGear = raids[0].partyInfo[pIndex].gear;
  } else {
    playersPrimaryMeleeGear = PrimaryMeleeGear.ELITE_VOID;
  }

  const chinsThrownIncorrectlyPercentage =
    stats.chinsThrownMaiden > 0
      ? (stats.chinsThrownIncorrectlyMaiden / stats.chinsThrownMaiden) * 100
      : 0;

  console.log('ligma', stats);

  return (
    <div className={styles.playerPage}>
      <div className={styles.playerPreview}>
        <div className={styles.playerImgWrapper}>
          <Image
            className={styles.raid__PlayerImg}
            src={`/${PrimaryMeleeGear[PrimaryMeleeGear.BLORVA].toLowerCase()}.webp`}
            alt={PrimaryMeleeGear[playersPrimaryMeleeGear].toLowerCase()}
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <h1>{player.formattedUsername}</h1>
      </div>
      <CollapsiblePanel
        panelTitle="Quick Stats"
        maxPanelHeight={9999}
        defaultExpanded
        disableExpansion
      >
        <div className={styles.stats}>
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Raids"
            value={player.totalRaidsRecorded}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Completions"
            value={stats.completions}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Resets"
            value={stats.resets}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Wipes"
            value={stats.wipes}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="BGS Smacks"
            value={stats.bgsSmacks}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Hammer Bops"
            value={stats.hammerBops}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Uncharged Scy Swings"
            value={stats.unchargedScytheSwings}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Barrage w/o Staff"
            value={stats.barragesWithoutProperWeapon}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Total Deaths"
            value={stats.deaths}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Maiden Deaths"
            value={stats.deathsMaiden}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Blert Deaths"
            value={stats.deathsBloat}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Nylo Deaths"
            value={stats.deathsNylocas}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Sote Deaths"
            value={stats.deathsSotetseg}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Xarpus Deaths"
            value={stats.deathsXarpus}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Verzik Deaths"
            value={stats.deathsVerzik}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Chins Thrown"
            value={stats.chinsThrown}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Chins Thrown Maiden"
            value={stats.chinsThrownMaiden}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Troll Chins"
            value={stats.chinsThrownIncorrectlyMaiden}
          />
          <Statistic
            supplementalClassName={styles.individualStat}
            name="Troll Chins %"
            value={chinsThrownIncorrectlyPercentage.toFixed(1)}
            showAsPercentage={true}
          />
        </div>
      </CollapsiblePanel>
      <CollapsiblePanel
        panelTitle="Recent Raids"
        maxPanelHeight={800}
        defaultExpanded
      >
        <RaidHistory raids={raids} />
      </CollapsiblePanel>
    </div>
  );
}
