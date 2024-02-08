'use client';

import Image from 'next/image';
import { Event, Room } from '@blert/common';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { loadEventsForRoom } from '../../../../actions/raid';

import styles from './style.module.scss';

export default function Maiden({ params: { id } }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const requestedTick = Number.parseInt(searchParams.get('tick') || '1', 10);

  console.log('Requested tick:', requestedTick);

  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    const getEvents = async () => {
      const evts = await loadEventsForRoom(id, Room.MAIDEN);
      setEvents(evts);
    };

    getEvents();
  }, [id]);

  console.log('Events: ', events);

  return (
    <div className={styles.bossPage}>
      <div className={styles.bossPage__Inner}>
        <div className={styles.bossPage__Overview}>
          <div className={styles.bossPage__BossPic}>
            <Image
              src="/maiden.webp"
              alt="Maiden of Sugadinti"
              width={200}
              height={200}
            />
          </div>
          <div className={styles.bossPage__KeyDetails}></div>
        </div>
        <div className={styles.bossPage__Controls}></div>
        <div className={styles.bossPage__AttackTimeline}></div>
        <div className={styles.bossPage__Replay}></div>
        <div className={styles.bossPage__Graffs}></div>
      </div>
    </div>
  );
}
