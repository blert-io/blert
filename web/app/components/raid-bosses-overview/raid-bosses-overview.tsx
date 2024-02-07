import Image from 'next/image';

import styles from './style.module.scss';
import { ticksToFormattedSeconds } from '../../raid/tick';
import { Room, RoomOverview } from '@blert/common';

interface RaidBossesOverviewProps {
  rooms: {
    [room in Room]?: RoomOverview;
  };
}

export function RaidBossesOverview(props: RaidBossesOverviewProps) {
  const { rooms } = props;

  const maidenDataExists = rooms[Room.MAIDEN] !== undefined;
  const bloatDataExists = rooms[Room.BLOAT] !== undefined;
  const nyloDataExists = rooms[Room.NYLOCAS] !== undefined;
  const soteDataExists = rooms[Room.SOTETSEG] !== undefined;
  const xarpusDataExists = rooms[Room.XARPUS] !== undefined;
  const verzikDataExists = rooms[Room.VERZIK] !== undefined;

  return (
    <div className={styles.raid__Bosses}>
      {maidenDataExists && (
        <div className={styles.raid__Boss}>
          <div className={styles.raid__BossImg}>
            <Image
              src="/maiden.webp"
              alt="maiden"
              height={130}
              width={130}
              style={{ position: 'relative', top: '30px', left: '22px' }}
            />
          </div>
          <div className={styles.raid__Divider}></div>
          <div className={styles.raid__RoomDetails}>
            <h4 className={styles.raid__BossName}>
              The Maiden of Sugadinti ·{' '}
              <i
                className="fa-solid fa-hourglass"
                style={{
                  paddingRight: '5px',
                  position: 'relative',
                  top: '-1px',
                  fontSize: '18px',
                }}
              ></i>
              {ticksToFormattedSeconds(rooms[Room.MAIDEN]!.roomTicks)}
            </h4>
            <div className={styles.raid__RoomBadges}>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  70s:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 100))}
              </div>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  50s:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 200))}
              </div>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  30s:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 300))}
              </div>
            </div>
          </div>
        </div>
      )}

      {bloatDataExists && (
        <div className={styles.raid__Boss}>
          <div className={styles.raid__BossImg}>
            <Image
              src="/bloat.webp"
              alt="bloat"
              height={145}
              width={145}
              style={{ position: 'relative', top: '35px', left: '10px' }}
            />
          </div>
          <div className={styles.raid__Divider}></div>
          <div className={styles.raid__RoomDetails}>
            <h4 className={styles.raid__BossName}>
              Pestilent Bloat ·{' '}
              <i
                className="fa-solid fa-hourglass"
                style={{
                  paddingRight: '5px',
                  position: 'relative',
                  top: '-1px',
                  fontSize: '18px',
                }}
              ></i>
              {ticksToFormattedSeconds(rooms[Room.BLOAT]!.roomTicks)}
            </h4>
            <div className={styles.raid__RoomBadges}>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  1st Down:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 100))}
              </div>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  2nd Down:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 200))}
              </div>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  3rd Down:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 200))}
              </div>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  4th Down:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 200))}
              </div>
            </div>
          </div>
        </div>
      )}

      {nyloDataExists && (
        <div className={styles.raid__Boss}>
          <div className={styles.raid__BossImg}>
            <Image
              src="/nyloking.webp"
              alt="nyloking"
              height={155}
              width={155}
              style={{ position: 'relative', left: '5px' }}
            />
          </div>
          <div className={styles.raid__Divider}></div>
          <div className={styles.raid__RoomDetails}>
            <h4 className={styles.raid__BossName}>
              The Nylocas ·{' '}
              <i
                className="fa-solid fa-hourglass"
                style={{
                  paddingRight: '5px',
                  position: 'relative',
                  top: '-1px',
                  fontSize: '18px',
                }}
              ></i>
              {ticksToFormattedSeconds(rooms[Room.NYLOCAS]!.roomTicks)}
            </h4>
            <div className={styles.raid__RoomBadges}>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  Cap:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 100))}
              </div>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  Waves:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 200))}
              </div>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  Cleanup:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 300))}
              </div>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  Boss:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 300))}
              </div>
            </div>
          </div>
        </div>
      )}

      {soteDataExists && (
        <div className={styles.raid__Boss}>
          <div className={styles.raid__BossImg}>
            <Image
              src="/sote.webp"
              alt="sotetseg"
              height={190}
              width={190}
              style={{
                position: 'relative',
                left: '5px',
                transform: `scale(1.2)`,
              }}
            />
          </div>
          <div className={styles.raid__Divider}></div>
          <div className={styles.raid__RoomDetails}>
            <h4 className={styles.raid__BossName}>
              Sotetseg ·{' '}
              <i
                className="fa-solid fa-hourglass"
                style={{
                  paddingRight: '5px',
                  position: 'relative',
                  top: '-1px',
                  fontSize: '18px',
                }}
              ></i>
              {ticksToFormattedSeconds(rooms[Room.SOTETSEG]!.roomTicks)}
            </h4>
            <div className={styles.raid__RoomBadges}>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  66%:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 100))}
              </div>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  33%:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 200))}
              </div>
            </div>
          </div>
        </div>
      )}

      {xarpusDataExists && (
        <div className={styles.raid__Boss}>
          <div className={styles.raid__BossImg}>
            <Image
              src="/xarpus.webp"
              alt="xarpus"
              height={185}
              width={185}
              style={{
                position: 'relative',
                left: '12px',
                transform: `scale(1.2)`,
              }}
            />
          </div>
          <div className={styles.raid__Divider}></div>
          <div className={styles.raid__RoomDetails}>
            <h4 className={styles.raid__BossName}>
              Xarpus ·{' '}
              <i
                className="fa-solid fa-hourglass"
                style={{
                  paddingRight: '5px',
                  position: 'relative',
                  top: '-1px',
                  fontSize: '18px',
                }}
              ></i>
              {ticksToFormattedSeconds(rooms[Room.XARPUS]!.roomTicks)}
            </h4>
            <div className={styles.raid__RoomBadges}>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  Exhumeds:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 100))}
              </div>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  Screech:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 200))}
              </div>
            </div>
          </div>
        </div>
      )}

      {verzikDataExists && (
        <div className={styles.raid__Boss}>
          <div className={styles.raid__BossImg}>
            <Image
              src="/verzik.webp"
              alt="verzik"
              height={180}
              width={180}
              style={{
                transform: `scale(1.15)`,
                position: 'relative',
                left: '8px',
              }}
            />
          </div>
          <div className={styles.raid__Divider}></div>
          <div className={styles.raid__RoomDetails}>
            <h4 className={styles.raid__BossName}>
              Verzik Vitur ·{' '}
              <i
                className="fa-solid fa-hourglass"
                style={{
                  paddingRight: '5px',
                  position: 'relative',
                  top: '-1px',
                  fontSize: '18px',
                }}
              ></i>
              {ticksToFormattedSeconds(rooms[Room.VERZIK]!.roomTicks)}
            </h4>
            <div className={styles.raid__RoomBadges}>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  P1:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 100))}
              </div>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  Reds:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 200))}
              </div>
              <div className={styles.raid__RoomBadge}>
                <strong>
                  <i
                    className="fa-solid fa-hourglass"
                    style={{ paddingRight: '5px' }}
                  ></i>
                  P3:
                </strong>{' '}
                {ticksToFormattedSeconds(Math.floor(Math.random() * 300))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
