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

import styles from './style.module.scss';

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

  const chinsThrownIncorrectlyPercentage =
    stats.chinsThrownMaiden > 0
      ? (stats.chinsThrownIncorrectlyMaiden / stats.chinsThrownMaiden) * 100
      : 0;

  return (
    <div className={styles.playerPage}>
      <h1>{player.formattedUsername}</h1>
      <CollapsiblePanel
        panelTitle="Quick Stats"
        maxPanelHeight={500}
        defaultExpanded
        disableExpansion
      >
        <div className={styles.stats}>
          <Statistic name="Raids" value={player.totalRaidsRecorded} />
          <Statistic name="Completions" value={stats.completions} />
          <Statistic name="Resets" value={stats.resets} />
          <Statistic name="Wipes" value={stats.wipes} />
        </div>
        <div className={styles.stats}>
          <div>
            {chinsThrownIncorrectlyPercentage.toFixed(2)}% chins incorrectly
            thrown xdddd
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
