'use client';

import { Mode, Raid, RaidStatus } from '@blert/common';
import { useEffect, useState } from 'react';
import TimeAgo from 'react-timeago';

import { loadRaid } from '../../actions/raid';
import RaidNavbar from './navbar';

import styles from './style.module.css';
import { ticksToFormattedSeconds } from '../tick';
import { RaidContext } from '../context';

type RaidParams = {
  id: string;
};

type RaidLayoutProps = {
  params: RaidParams;
  children: React.ReactNode;
};

const RAID_MODE_STRING = {
  [Mode.ENTRY]: 'Entry',
  [Mode.REGULAR]: 'Regular',
  [Mode.HARD]: 'Hard',
};

const RAID_STATUS_STRING = {
  [RaidStatus.IN_PROGRESS]: 'In Progress',
  [RaidStatus.COMPLETED]: 'Completed',
  [RaidStatus.MAIDEN_RESET]: 'Maiden Reset',
  [RaidStatus.MAIDEN_WIPE]: 'Maiden Wipe',
  [RaidStatus.BLOAT_RESET]: 'Bloat Reset',
  [RaidStatus.BLOAT_WIPE]: 'Bloat Wipe',
  [RaidStatus.NYLO_RESET]: 'Nylocas Reset',
  [RaidStatus.NYLO_WIPE]: 'Nylocas Wipe',
  [RaidStatus.SOTE_RESET]: 'Sotetseg Reset',
  [RaidStatus.SOTE_WIPE]: 'Sotetseg Wipe',
  [RaidStatus.XARPUS_RESET]: 'Xarpus Reset',
  [RaidStatus.XARPUS_WIPE]: 'Xarpus Wipe',
  [RaidStatus.VERZIK_WIPE]: 'Verzik Wipe',
};

export default function RaidLayout(props: RaidLayoutProps) {
  const id = props.params.id;

  const [raid, setRaid] = useState<Raid | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const getRaid = async () => {
      const raid = await loadRaid(id);
      if (raid) {
        setRaid(raid);
      } else {
        setError(true);
      }
    };

    getRaid();
  }, [id]);

  return (
    <div className={styles.raid}>
      <div className={styles.details}>
        <div className={styles.basic}>
          <div className={styles.id}>
            <h1>Raid #{id}</h1>
            <p>
              {raid && (
                <span>
                  {raid.status === RaidStatus.IN_PROGRESS
                    ? 'Started '
                    : 'Recorded '}
                  <TimeAgo date={raid.startTime} />
                </span>
              )}
            </p>
          </div>
          <div className={styles.icons}>
            <div className={styles.icon}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
                />
              </svg>

              <span className={styles.text}>
                {raid && RAID_STATUS_STRING[raid.status]}
              </span>
            </div>
            <div className={styles.icon}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0"
                />
              </svg>
              <span className={styles.text}>
                {raid && RAID_MODE_STRING[raid.mode]}
              </span>
            </div>
            <div className={styles.icon}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
                />
              </svg>
              <span className={styles.text}>{raid && raid.party.length}</span>
            </div>
            <div className={styles.icon}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className={styles.text}>
                {raid && ticksToFormattedSeconds(raid.totalRoomTicks)}
              </span>
            </div>
          </div>
        </div>
        <RaidNavbar id={id} />
      </div>
      <RaidContext.Provider value={raid}>
        <div className={styles.content}>{props.children}</div>
      </RaidContext.Provider>
    </div>
  );
}
