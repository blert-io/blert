import { PersonalBestType, PrimaryMeleeGear } from '@blert/common';
import Link from 'next/link';
import Image from 'next/image';

import { loadPbsForPlayer, loadPlayerWithStats } from '../../actions/challenge';
import CollapsiblePanel from '../../components/collapsible-panel';
import ChallengeHistory from '../../components/challenge-history';
import Statistic from '../../components/statistic';
import { ticksToFormattedSeconds } from '../../utils/tick';

import styles from './style.module.scss';
import { ResolvingMetadata } from 'next';

type PlayerPageProps = {
  params: { username: string };
};

const STATISTIC_WIDTH = 126;

type PbEntry = {
  title: string;
  raidId: string | null;
  time: number | null;
};

type PbTableProps = {
  title: string;
  pbs: PbEntry[];
};

function PbTable({ title, pbs }: PbTableProps) {
  const pbOrNone = (pb: number | null) =>
    pb === null ? '--:--.-' : ticksToFormattedSeconds(pb);

  return (
    <div className={styles.pbTable}>
      <h2>{title}</h2>
      <div className={styles.pbs}>
        {pbs.map(
          (pb) =>
            (pb.raidId !== null && (
              <Link
                href={`/raids/tob/${pb.raidId}/overview`}
                key={pb.title}
                className={styles.pb}
              >
                <span className={styles.time}>{pbOrNone(pb.time)}</span>
                <span className={styles.scale}>{pb.title}</span>
              </Link>
            )) || (
              <div key={pb.title} className={styles.pb}>
                <span className={styles.time}>{pbOrNone(pb.time)}</span>
                <span className={styles.scale}>{pb.title}</span>
              </div>
            ),
        )}
      </div>
    </div>
  );
}

export default async function Player(props: PlayerPageProps) {
  const username = decodeURIComponent(props.params.username);

  const [player, personalBests] = await Promise.all([
    loadPlayerWithStats(username),
    loadPbsForPlayer(username),
  ]);

  if (player === null) {
    // TODO(sam): player 404 page
    return <div>Player {username} not found</div>;
  }

  const stats = player.stats;

  // TODO(frolv): Compute and store primary melee gear in the database.
  const playersPrimaryMeleeGear = PrimaryMeleeGear.BLORVA;

  const chinsThrownIncorrectlyPercentage =
    stats.chinsThrownMaiden > 0
      ? (stats.chinsThrownIncorrectlyMaiden / stats.chinsThrownMaiden) * 100
      : 0;

  const regPbs: PbEntry[] = [
    { title: 'Solo', raidId: null, time: null },
    { title: 'Duo', raidId: null, time: null },
    { title: 'Trio', raidId: null, time: null },
    { title: '4s', raidId: null, time: null },
    { title: '5s', raidId: null, time: null },
  ];
  const hmtPbs: PbEntry[] = [
    { title: 'Solo', raidId: null, time: null },
    { title: 'Duo', raidId: null, time: null },
    { title: 'Trio', raidId: null, time: null },
    { title: '4s', raidId: null, time: null },
    { title: '5s', raidId: null, time: null },
  ];

  for (const pb of personalBests) {
    if (pb.type === PersonalBestType.TOB_REG_CHALLENGE) {
      regPbs[pb.scale - 1].time = pb.time;
      regPbs[pb.scale - 1].raidId = pb.cId;
    } else if (pb.type === PersonalBestType.TOB_HM_CHALLENGE) {
      hmtPbs[pb.scale - 1].time = pb.time;
      hmtPbs[pb.scale - 1].raidId = pb.cId;
    }
  }

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
        panelTitle="Personal bests"
        maxPanelHeight={9999}
        defaultExpanded
        disableExpansion
      >
        <div className={styles.pbWrapper}>
          <PbTable title="ToB Regular" pbs={regPbs} />
          <PbTable title="ToB Hard Mode" pbs={hmtPbs} />
        </div>
      </CollapsiblePanel>
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
              className={styles.individualStat}
              name="Total"
              value={player.totalRaidsRecorded}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Completions"
              value={stats.completions}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Resets"
              value={stats.resets}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Wipes"
              value={stats.wipes}
              width={STATISTIC_WIDTH}
            />
          </div>
          <h2>Trolls</h2>
          <div className={styles.stats}>
            <Statistic
              className={styles.individualStat}
              name="BGS Smacks"
              value={stats.bgsSmacks}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Hammer Bops"
              value={stats.hammerBops}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Uncharged Scy Swings"
              value={stats.unchargedScytheSwings}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Barrages w/o Staff"
              value={stats.barragesWithoutProperWeapon}
              width={STATISTIC_WIDTH}
            />
          </div>
          <h2>Deaths</h2>
          <div className={styles.stats}>
            <Statistic
              className={styles.individualStat}
              name="Total"
              value={stats.deaths}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Maiden"
              value={stats.deathsMaiden}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Bloat"
              value={stats.deathsBloat}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Nylo"
              value={stats.deathsNylocas}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Sote"
              value={stats.deathsSotetseg}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Xarpus"
              value={stats.deathsXarpus}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Verzik"
              value={stats.deathsVerzik}
              width={STATISTIC_WIDTH}
            />
          </div>
          <h2>Chins</h2>
          <div className={styles.stats}>
            <Statistic
              className={styles.individualStat}
              name="Chins Thrown"
              value={stats.chinsThrown}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Thrown during Maiden"
              value={stats.chinsThrownMaiden}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Thrown Incorrectly"
              value={stats.chinsThrownIncorrectlyMaiden}
              width={STATISTIC_WIDTH}
            />
            <Statistic
              className={styles.individualStat}
              name="Troll Chins %"
              value={chinsThrownIncorrectlyPercentage.toFixed(1)}
              width={STATISTIC_WIDTH}
              unit="%"
            />
            <Statistic
              className={styles.individualStat}
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
        maxPanelHeight={2000}
        defaultExpanded
        className={styles.recentRaids}
      >
        <ChallengeHistory count={10} username={player.username} />
      </CollapsiblePanel>
    </div>
  );
}

export async function generateMetadata(
  { params }: PlayerPageProps,
  parent: ResolvingMetadata,
) {
  const username = decodeURIComponent(params.username);
  const [player, metadata] = await Promise.all([
    loadPlayerWithStats(username),
    parent,
  ]);

  if (player === null) {
    return { title: 'Player not found' };
  }

  const description = `View ${player.formattedUsername}'s statistics on Blert, Old School RuneScape's premier PvM tracker.`;

  return {
    title: player.formattedUsername,
    description,
    openGraph: { ...metadata.openGraph, description },
    twitter: {
      ...metadata.twitter,
      title: `${player.formattedUsername} | Blert`,
      description,
    },
  };
}

export const dynamic = 'force-dynamic';
