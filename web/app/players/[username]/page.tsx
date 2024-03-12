'use client';

import { use, useEffect, useState } from 'react';

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

const STATISTIC_WIDTH = 126;

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

  useEffect(() => {
    const name = player?.formattedUsername ?? username;
    document.title = `${name} | Blert`;

    return () => {
      document.title = 'Blert';
    };
  }, [player]);

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
    playersPrimaryMeleeGear =
      raids[0].partyInfo[pIndex]?.gear ?? PrimaryMeleeGear.ELITE_VOID;
  } else {
    playersPrimaryMeleeGear = PrimaryMeleeGear.ELITE_VOID;
  }

  const chinsThrownIncorrectlyPercentage =
    stats.chinsThrownMaiden > 0
      ? (stats.chinsThrownIncorrectlyMaiden / stats.chinsThrownMaiden) * 100
      : 0;

  return (
    <div className={styles.playerPage}>
      <div className={styles.playerPreview}>
        <div className={styles.playerImgWrapper}>
          <Image
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
        <div className={styles.statsWrapper}>
          <h2>Raids</h2>
          <div className={styles.stats}>
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Total"
              value={player.totalRaidsRecorded}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Completions"
              value={stats.completions}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Resets"
              value={stats.resets}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Wipes"
              value={stats.wipes}
              width={STATISTIC_WIDTH}
            />
          </div>
          <h2>Trolls</h2>
          <div className={styles.stats}>
            <Statistic
              supplementalClassName={styles.individualStat}
              name="BGS Smacks"
              value={stats.bgsSmacks}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Hammer Bops"
              value={stats.hammerBops}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Uncharged Scy Swings"
              value={stats.unchargedScytheSwings}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Barrages w/o Staff"
              value={stats.barragesWithoutProperWeapon}
              width={STATISTIC_WIDTH}
            />
          </div>
          <h2>Deaths</h2>
          <div className={styles.stats}>
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Total"
              value={stats.deaths}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Maiden"
              value={stats.deathsMaiden}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Bloat"
              value={stats.deathsBloat}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Nylo"
              value={stats.deathsNylocas}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Sote"
              value={stats.deathsSotetseg}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Xarpus"
              value={stats.deathsXarpus}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Verzik"
              value={stats.deathsVerzik}
              width={STATISTIC_WIDTH}
            />
          </div>
          <h2>Chins</h2>
          <div className={styles.stats}>
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Chins Thrown"
              value={stats.chinsThrown}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Thrown at Maiden"
              value={stats.chinsThrownMaiden}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Thrown Incorrectly"
              value={stats.chinsThrownIncorrectlyMaiden}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Troll Chins %"
              value={chinsThrownIncorrectlyPercentage.toFixed(1)}
              width={STATISTIC_WIDTH}
              unit="%"
            />
            <Statistic
              supplementalClassName={styles.individualStat}
              name="Value of Chins Thrown"
              value={stats.chinsThrownValue}
              width={STATISTIC_WIDTH}
              unit="gp"
            />
          </div>
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
