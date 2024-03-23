import Link from 'next/link';

import { RaidOverview } from '../../actions/raid';
import { RaidQuickDetails } from '../raid-quick-details/raid-quick-details';

import styles from './style.module.scss';

type RaidHistoryProps = {
  raids: RaidOverview[];
  loading?: boolean;
};

export default function RaidHistory(props: RaidHistoryProps) {
  let content;

  if (props.loading) {
    content = <div className={styles.message}>Loading...</div>;
  } else if (props.raids.length === 0) {
    content = <div className={styles.message}>No raids found</div>;
  } else {
    content = props.raids.map((raid) => (
      <Link
        href={`/raids/tob/${raid._id}/overview`}
        key={`recent-raid-${raid._id}`}
      >
        <div className={styles.recentRaid}>
          <div className={styles.recentRaidTeam}>
            <span style={{ fontWeight: 'bold' }}>Players: </span>
            {raid.party.join(', ')}
          </div>
          <RaidQuickDetails
            stage={raid.stage}
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
  }

  return <div className={styles.history}>{content}</div>;
}
