'use client';

import Image from 'next/image';

import styles from './style.module.scss';
import {
  BloatOverview,
  MaidenCrabSpawn,
  MaidenOverview,
  NyloOverview,
  Room,
  RoomOverview,
  Rooms,
  SoteOverview,
  VerzikOverview,
  XarpusOverview,
} from '@blert/common';
import Link from 'next/link';
import { ticksToFormattedSeconds } from '../../utils/tick';
import { getOrdinal } from '../../utils/path-util';

interface RaidBossesOverviewProps {
  raidId: string;
  rooms: Rooms;
}

export function RaidBossesOverview(props: RaidBossesOverviewProps) {
  const { /*rooms,*/ raidId } = props;

  let rooms = props.rooms;

  const maidenDataExists = rooms[Room.MAIDEN] !== null;
  const bloatDataExists = rooms[Room.BLOAT] !== null;
  const nyloDataExists = rooms[Room.NYLOCAS] !== null;
  const soteDataExists = rooms[Room.SOTETSEG] !== null;
  const xarpusDataExists = rooms[Room.XARPUS] !== null;
  const verzikDataExists = rooms[Room.VERZIK] !== null;

  console.log(rooms);

  let maiden = maidenDataExists
    ? (rooms[Room.MAIDEN] as MaidenOverview)
    : undefined;
  let bloat = bloatDataExists
    ? (rooms[Room.BLOAT] as BloatOverview)
    : undefined;
  let nylo = nyloDataExists ? (rooms[Room.NYLOCAS] as NyloOverview) : undefined;
  let sote = soteDataExists
    ? (rooms[Room.SOTETSEG] as SoteOverview)
    : undefined;
  let xarpus = xarpusDataExists
    ? (rooms[Room.XARPUS] as XarpusOverview)
    : undefined;
  let verzik = verzikDataExists
    ? (rooms[Room.VERZIK] as VerzikOverview)
    : undefined;

  let bloatDowns = undefined;

  if (bloatDataExists) {
    bloatDowns = bloat!.splits.downTicks.map((split, index) => {
      return (
        <div
          key={`bloat-split-${split + 1}`}
          className={styles.raid__RoomBadge}
        >
          <strong>
            <i
              className="fa-solid fa-hourglass"
              style={{ paddingRight: '5px' }}
            ></i>
            {getOrdinal(index + 1)} Down:
          </strong>{' '}
          {ticksToFormattedSeconds(split)}
        </div>
      );
    });
  }

  return (
    <div className={styles.raid__Bosses}>
      {/*************************/
      /*  Maiden */
      /*************************/}
      {maidenDataExists && (
        <Link href={`/raids/tob//${raidId}/maiden`}>
          <div className={styles.raid__Boss}>
            <div className={styles.raid__BossImg}>
              <Image
                className={styles.raid__BossImgActual}
                src="/maiden.webp"
                alt="maiden"
                fill
                style={{
                  transform: 'scale(3)',
                  objectFit: 'contain',
                  top: '100px',
                  left: '30px',
                }}
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
                {maiden!.splits[MaidenCrabSpawn.SEVENTIES] !== 0 && (
                  <div className={styles.raid__RoomBadge}>
                    <strong>
                      <i
                        className="fa-solid fa-hourglass"
                        style={{ paddingRight: '5px' }}
                      ></i>
                      70s:
                    </strong>{' '}
                    {ticksToFormattedSeconds(
                      maiden!.splits[MaidenCrabSpawn.SEVENTIES],
                    )}
                  </div>
                )}
                {maiden!.splits[MaidenCrabSpawn.FIFTIES] !== 0 && (
                  <div className={styles.raid__RoomBadge}>
                    <strong>
                      <i
                        className="fa-solid fa-hourglass"
                        style={{ paddingRight: '5px' }}
                      ></i>
                      50s:
                    </strong>{' '}
                    {ticksToFormattedSeconds(
                      maiden!.splits[MaidenCrabSpawn.FIFTIES],
                    )}
                  </div>
                )}
                {maiden!.splits[MaidenCrabSpawn.THIRTIES] !== 0 && (
                  <div className={styles.raid__RoomBadge}>
                    <strong>
                      <i
                        className="fa-solid fa-hourglass"
                        style={{ paddingRight: '5px' }}
                      ></i>
                      30s:
                    </strong>{' '}
                    {ticksToFormattedSeconds(
                      maiden!.splits[MaidenCrabSpawn.THIRTIES],
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Link>
      )}

      {/*************************/
      /*  Bloat */
      /*************************/}
      {bloatDataExists && (
        <Link href={`/raids/tob//${raidId}/bloat`}>
          <div className={styles.raid__Boss}>
            <div className={styles.raid__BossImg}>
              <Image
                src="/bloat.webp"
                alt="bloat"
                fill
                style={{
                  transform: 'scale(2)',
                  objectFit: 'contain',
                  top: '50px',
                  left: '10px',
                }}
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
              <div className={styles.raid__RoomBadges}>{bloatDowns}</div>
            </div>
          </div>
        </Link>
      )}

      {/*************************/
      /*  Nylos */
      /*************************/}
      {nyloDataExists && (
        <Link href={`/raids/tob//${raidId}/nylocas`}>
          <div className={styles.raid__Boss}>
            <div className={styles.raid__BossImg}>
              <Image
                src="/nyloking.webp"
                alt="nyloking"
                fill
                style={{
                  transform: 'scale(2)',
                  objectFit: 'contain',
                  top: '10px',
                  left: '5px',
                }}
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
                  {ticksToFormattedSeconds(nylo!.splits.capIncrease)}
                </div>

                <div className={styles.raid__RoomBadge}>
                  <strong>
                    <i
                      className="fa-solid fa-hourglass"
                      style={{ paddingRight: '5px' }}
                    ></i>
                    Waves:
                  </strong>{' '}
                  {ticksToFormattedSeconds(nylo!.splits.waves)}
                </div>

                <div className={styles.raid__RoomBadge}>
                  <strong>
                    <i
                      className="fa-solid fa-hourglass"
                      style={{ paddingRight: '5px' }}
                    ></i>
                    Cleanup:
                  </strong>{' '}
                  {ticksToFormattedSeconds(nylo!.splits.cleanup)}
                </div>

                <div className={styles.raid__RoomBadge}>
                  <strong>
                    <i
                      className="fa-solid fa-hourglass"
                      style={{ paddingRight: '5px' }}
                    ></i>
                    Boss:
                  </strong>{' '}
                  {ticksToFormattedSeconds(nylo!.splits.boss)}
                </div>
              </div>
            </div>
          </div>
        </Link>
      )}

      {/*************************/
      /*  Sote */
      /*************************/}
      {soteDataExists && (
        <Link href={`/raids/tob//${raidId}/sotetseg`}>
          <div className={styles.raid__Boss}>
            <div className={styles.raid__BossImg}>
              <Image
                src="/sote.webp"
                alt="sotetseg"
                fill
                style={{
                  transform: 'scale(1.25)',
                  objectFit: 'contain',
                  top: '0px',
                  left: '5px',
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
                  {ticksToFormattedSeconds(sote!.splits.MAZE_66)}
                </div>
                <div className={styles.raid__RoomBadge}>
                  <strong>
                    <i
                      className="fa-solid fa-hourglass"
                      style={{ paddingRight: '5px' }}
                    ></i>
                    33%:
                  </strong>{' '}
                  {ticksToFormattedSeconds(sote!.splits.MAZE_33)}
                </div>
              </div>
            </div>
          </div>
        </Link>
      )}

      {/*************************/
      /*  Xarpus */
      /*************************/}
      {xarpusDataExists && (
        <Link href={`/raids/tob//${raidId}/xarpus`}>
          <div className={styles.raid__Boss}>
            <div className={styles.raid__BossImg}>
              <Image
                src="/xarpus.webp"
                alt="xarpus"
                fill
                style={{
                  transform: 'scale(1.5)',
                  objectFit: 'contain',
                  top: '0px',
                  left: '15px',
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
                {ticksToFormattedSeconds(xarpus!.roomTicks)}
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
                  {ticksToFormattedSeconds(xarpus!.splits.exhumes)}
                </div>
                <div className={styles.raid__RoomBadge}>
                  <strong>
                    <i
                      className="fa-solid fa-hourglass"
                      style={{ paddingRight: '5px' }}
                    ></i>
                    Screech:
                  </strong>{' '}
                  {ticksToFormattedSeconds(xarpus!.splits.screech)}
                </div>
              </div>
            </div>
          </div>
        </Link>
      )}

      {/*************************/
      /*  Verzik */
      /*************************/}
      {verzikDataExists && (
        <Link href={`/raids/tob//${raidId}/verzik`}>
          <div className={styles.raid__Boss}>
            <div className={styles.raid__BossImg}>
              <Image
                src="/verzik.webp"
                alt="verzik"
                fill
                style={{
                  transform: 'scale(1.65)',
                  objectFit: 'contain',
                  top: '10px',
                  left: '10px',
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
                {ticksToFormattedSeconds(verzik!.roomTicks)}
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
                  {ticksToFormattedSeconds(verzik!.splits.p1)}
                </div>
                <div className={styles.raid__RoomBadge}>
                  <strong>
                    <i
                      className="fa-solid fa-hourglass"
                      style={{ paddingRight: '5px' }}
                    ></i>
                    Reds:
                  </strong>{' '}
                  {ticksToFormattedSeconds(verzik!.splits.reds)}
                </div>
                <div className={styles.raid__RoomBadge}>
                  <strong>
                    <i
                      className="fa-solid fa-hourglass"
                      style={{ paddingRight: '5px' }}
                    ></i>
                    P2:
                  </strong>{' '}
                  {ticksToFormattedSeconds(verzik!.splits.p2)}
                </div>
              </div>
            </div>
          </div>
        </Link>
      )}
    </div>
  );
}
