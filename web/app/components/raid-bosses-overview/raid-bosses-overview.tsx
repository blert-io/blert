'use client';

import { SplitType, TobRooms } from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';

import Badge from '../badge';
import { ticksToFormattedSeconds } from '../../utils/tick';
import { getOrdinal } from '../../utils/path-util';

import styles from './style.module.scss';

interface RaidBossesOverviewProps {
  raidId: string;
  rooms: TobRooms;
  splits: Partial<Record<SplitType, number>>;
}

export function RaidBossesOverview(props: RaidBossesOverviewProps) {
  const { rooms, raidId, splits } = props;

  let bloatDowns = undefined;

  if (rooms.bloat) {
    bloatDowns = rooms.bloat.downTicks.map((split, index) => (
      <Badge
        key={index}
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
      {rooms.maiden && (
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
                {ticksToFormattedSeconds(splits[SplitType.TOB_MAIDEN] ?? 0)}
              </h4>
              <div className={styles.raid__RoomBadges}>
                {splits[SplitType.TOB_MAIDEN_70S] && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="70s"
                    value={ticksToFormattedSeconds(
                      splits[SplitType.TOB_MAIDEN_70S],
                    )}
                  />
                )}
                {splits[SplitType.TOB_MAIDEN_50S] && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="50s"
                    value={ticksToFormattedSeconds(
                      splits[SplitType.TOB_MAIDEN_50S],
                    )}
                  />
                )}
                {splits[SplitType.TOB_MAIDEN_30S] && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="30s"
                    value={ticksToFormattedSeconds(
                      splits[SplitType.TOB_MAIDEN_30S],
                    )}
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
      {rooms.bloat && (
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
                {ticksToFormattedSeconds(splits[SplitType.TOB_BLOAT] ?? 0)}
              </h4>
              <div className={styles.raid__RoomBadges}>{bloatDowns}</div>
            </div>
          </div>
        </Link>
      )}

      {/*************************/
      /*  Nylos */
      /*************************/}
      {rooms.nylocas && (
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
                {ticksToFormattedSeconds(splits[SplitType.TOB_NYLO_ROOM] ?? 0)}
              </h4>
              <div className={styles.raid__RoomBadges}>
                {splits[SplitType.TOB_NYLO_CAP] && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="Cap"
                    value={ticksToFormattedSeconds(
                      splits[SplitType.TOB_NYLO_CAP],
                    )}
                  />
                )}
                {splits[SplitType.TOB_NYLO_WAVES] && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="Waves"
                    value={ticksToFormattedSeconds(
                      splits[SplitType.TOB_NYLO_WAVES],
                    )}
                  />
                )}
                {splits[SplitType.TOB_NYLO_CLEANUP] && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="Cleanup"
                    value={ticksToFormattedSeconds(
                      splits[SplitType.TOB_NYLO_CLEANUP],
                    )}
                  />
                )}
                {splits[SplitType.TOB_NYLO_BOSS_SPAWN] && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="Boss"
                    value={ticksToFormattedSeconds(
                      splits[SplitType.TOB_NYLO_BOSS_SPAWN],
                    )}
                  />
                )}
              </div>
              <div className={styles.raid__RoomBadges}>
                <Badge
                  iconClass="fa-solid fa-dumpster-fire"
                  label="Pre-cap Stalls"
                  value={
                    rooms.nylocas.stalledWaves.filter((wave) => wave < 20)
                      .length
                  }
                />
                <Badge
                  iconClass="fa-solid fa-circle-question"
                  label="Post-cap Stalls"
                  value={
                    rooms.nylocas.stalledWaves.filter((wave) => wave >= 20)
                      .length
                  }
                />
              </div>
            </div>
          </div>
        </Link>
      )}

      {/*************************/
      /*  Sote */
      /*************************/}
      {rooms.sotetseg && (
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
                {ticksToFormattedSeconds(splits[SplitType.TOB_SOTETSEG] ?? 0)}
              </h4>
              <div className={styles.raid__RoomBadges}>
                {splits[SplitType.TOB_SOTETSEG_66] && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="66%"
                    value={ticksToFormattedSeconds(
                      splits[SplitType.TOB_SOTETSEG_66],
                    )}
                  />
                )}
                {splits[SplitType.TOB_SOTETSEG_33] && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="33%"
                    value={ticksToFormattedSeconds(
                      splits[SplitType.TOB_SOTETSEG_33],
                    )}
                  />
                )}
              </div>
            </div>
          </div>
        </Link>
      )}

      {/*************************/
      /*  Xarpus */
      /*************************/}
      {rooms.xarpus && (
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
                {ticksToFormattedSeconds(splits[SplitType.TOB_XARPUS] ?? 0)}
              </h4>
              <div className={styles.raid__RoomBadges}>
                {splits[SplitType.TOB_XARPUS_EXHUMES] && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="Exhumes"
                    value={ticksToFormattedSeconds(
                      splits[SplitType.TOB_XARPUS_EXHUMES],
                    )}
                  />
                )}
                {splits[SplitType.TOB_XARPUS_SCREECH] && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="Screech"
                    value={ticksToFormattedSeconds(
                      splits[SplitType.TOB_XARPUS_SCREECH],
                    )}
                  />
                )}
              </div>
            </div>
          </div>
        </Link>
      )}

      {/*************************/
      /*  Verzik */
      /*************************/}
      {rooms.verzik && (
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
                {ticksToFormattedSeconds(
                  splits[SplitType.TOB_VERZIK_ROOM] ?? 0,
                )}
              </h4>
              <div className={styles.raid__RoomBadges}>
                {splits[SplitType.TOB_VERZIK_P1_END] && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="P1"
                    value={ticksToFormattedSeconds(
                      splits[SplitType.TOB_VERZIK_P1_END],
                    )}
                  />
                )}
                {splits[SplitType.TOB_VERZIK_REDS] && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="Reds"
                    value={ticksToFormattedSeconds(
                      splits[SplitType.TOB_VERZIK_REDS],
                    )}
                  />
                )}
                {splits[SplitType.TOB_VERZIK_P2_END] && (
                  <Badge
                    iconClass="fa-solid fa-hourglass"
                    label="P2"
                    value={ticksToFormattedSeconds(
                      splits[SplitType.TOB_VERZIK_P2_END],
                    )}
                  />
                )}
              </div>
            </div>
          </div>
        </Link>
      )}
    </div>
  );
}
