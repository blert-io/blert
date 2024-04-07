'use client';

import {
  BloatOverview,
  MaidenOverview,
  NyloOverview,
  SoteOverview,
  TobRooms,
  VerzikOverview,
  XarpusOverview,
} from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';

import Badge from '../badge';
import { ticksToFormattedSeconds } from '../../utils/tick';
import { getOrdinal } from '../../utils/path-util';

import styles from './style.module.scss';

interface RaidBossesOverviewProps {
  raidId: string;
  rooms: TobRooms;
}

export function RaidBossesOverview(props: RaidBossesOverviewProps) {
  const { /*rooms,*/ raidId } = props;

  let rooms = props.rooms;

  const maidenDataExists = rooms.maiden !== null;
  const bloatDataExists = rooms.bloat !== null;
  const nyloDataExists = rooms.nylocas !== null;
  const soteDataExists = rooms.sotetseg !== null;
  const xarpusDataExists = rooms.xarpus !== null;
  const verzikDataExists = rooms.verzik !== null;

  let maiden = maidenDataExists ? (rooms.maiden as MaidenOverview) : undefined;
  let bloat = bloatDataExists ? (rooms.bloat as BloatOverview) : undefined;
  let nylo = nyloDataExists ? (rooms.nylocas as NyloOverview) : undefined;
  let sote = soteDataExists ? (rooms.sotetseg as SoteOverview) : undefined;
  let xarpus = xarpusDataExists ? (rooms.xarpus as XarpusOverview) : undefined;
  let verzik = verzikDataExists ? (rooms.verzik as VerzikOverview) : undefined;

  let bloatDowns = undefined;

  if (bloatDataExists) {
    bloatDowns = bloat!.splits.downTicks.map((split, index) => (
      <Badge
        iconClass="fa-solid fa-hourglass"
        label={getOrdinal(index + 1) + ' Down'}
        value={ticksToFormattedSeconds(split)}
      />
    ));
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
                {ticksToFormattedSeconds(maiden!.roomTicks)}
              </h4>
              <div className={styles.raid__RoomBadges}>
                {maiden!.splits.SEVENTIES !== 0 && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="70s"
                    value={ticksToFormattedSeconds(maiden!.splits.SEVENTIES)}
                  />
                )}
                {maiden!.splits.FIFTIES !== 0 && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="50s"
                    value={ticksToFormattedSeconds(maiden!.splits.FIFTIES)}
                  />
                )}
                {maiden!.splits.THIRTIES !== 0 && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="30s"
                    value={ticksToFormattedSeconds(maiden!.splits.THIRTIES)}
                  />
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
                {ticksToFormattedSeconds(bloat!.roomTicks)}
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
                {ticksToFormattedSeconds(nylo!.roomTicks)}
              </h4>
              <div className={styles.raid__RoomBadges}>
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="Cap"
                  value={ticksToFormattedSeconds(nylo!.splits.capIncrease)}
                />
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="Waves"
                  value={ticksToFormattedSeconds(nylo!.splits.waves)}
                />
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="Cleanup"
                  value={ticksToFormattedSeconds(nylo!.splits.cleanup)}
                />
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="Boss"
                  value={ticksToFormattedSeconds(nylo!.splits.boss)}
                />
              </div>
              <div className={styles.raid__RoomBadges}>
                <Badge
                  iconClass="fa-solid fa-dumpster-fire"
                  label="Pre-cap Stalls"
                  value={nylo!.stalledWaves.filter((wave) => wave < 20).length}
                />
                <Badge
                  iconClass="fa-solid fa-circle-question"
                  label="Post-cap Stalls"
                  value={nylo!.stalledWaves.filter((wave) => wave >= 20).length}
                />
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
                {ticksToFormattedSeconds(sote!.roomTicks)}
              </h4>
              <div className={styles.raid__RoomBadges}>
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="66%"
                  value={ticksToFormattedSeconds(sote!.splits.MAZE_66)}
                />
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="33%"
                  value={ticksToFormattedSeconds(sote!.splits.MAZE_33)}
                />
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
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="Exhumes"
                  value={ticksToFormattedSeconds(xarpus!.splits.exhumes)}
                />
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="Screech"
                  value={ticksToFormattedSeconds(xarpus!.splits.screech)}
                />
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
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="P1"
                  value={ticksToFormattedSeconds(verzik!.splits.p1)}
                />
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="Reds"
                  value={ticksToFormattedSeconds(verzik!.splits.reds)}
                />
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="P2"
                  value={ticksToFormattedSeconds(verzik!.splits.p2)}
                />
              </div>
            </div>
          </div>
        </Link>
      )}
    </div>
  );
}
