import Link from 'next/link';

import { RaidOverview } from '../../actions/raid';
import { RaidQuickDetails } from '../raid-quick-details/raid-quick-details';

import styles from './style.module.scss';

type RaidHistoryProps = {
  raids: RaidOverview[];
};

export default function RaidHistory(props: RaidHistoryProps) {
  return (
    <div>
      {props.raids.map((raid) => (
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
      ))}
    </div>
  );
}
