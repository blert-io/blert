'use client';

import { SplitType, TobRooms } from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';

import Badge from '@/components/badge';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import { useDisplay } from '@/display';
import { getOrdinal } from '@/utils/path-util';
import { ticksToFormattedSeconds } from '@/utils/tick';

import styles from './style.module.scss';

interface RaidBossesOverviewProps {
  raidId: string;
  rooms: TobRooms;
  splits: Partial<Record<SplitType, number>>;
}

function deathsTooltip(deaths: string[]): string {
  if (deaths.length === 0) {
    return '';
  }
  return `Deaths: ${deaths.join(', ')}`;
}

export function RaidBossesOverview(props: RaidBossesOverviewProps) {
  const { rooms, raidId, splits } = props;
  const display = useDisplay();

  let bloatDowns = undefined;

  if (rooms.bloat) {
    bloatDowns = rooms.bloat.downTicks.map((split, index) => (
      <Badge
        key={index}
        iconClass="fa-solid fa-hourglass"
        label={getOrdinal(index + 1) + ' Down'}
        value={ticksToFormattedSeconds(split)}
        href={`/raids/tob/${raidId}/bloat?tick=${split}`}
      />
    ));
  }

  return (
    <div className={styles.bossesOverview}>
      {/*************************/
      /*  Maiden */
      /*************************/}
      {rooms.maiden && (
        <Link href={`/raids/tob/${raidId}/maiden`} className={styles.boss}>
          <div className={styles.bossImg}>
            <Image
              src="/maiden.webp"
              alt="maiden"
              fill
              style={{
                transform: 'scale(3)',
                objectFit: 'contain',
                top: display.isCompact() ? 70 : 110,
                left: display.isCompact() ? 14 : 24,
              }}
            />
          </div>
          <div className={styles.roomDetails}>
            <h4 className={styles.bossName}>
              The Maiden of Sugadinti
              <i className="fa-solid fa-hourglass" />
              {ticksToFormattedSeconds(splits[SplitType.TOB_MAIDEN] ?? 0)}
              {rooms.maiden.deaths.length > 0 && (
                <div
                  className={styles.deathCount}
                  data-tooltip-id={GLOBAL_TOOLTIP_ID}
                  data-tooltip-content={deathsTooltip(rooms.maiden.deaths)}
                >
                  <i className="fa-solid fa-skull" />
                  {rooms.maiden.deaths.length}
                </div>
              )}
            </h4>
            <div className={styles.roomBadges}>
              {splits[SplitType.TOB_MAIDEN_70S] && (
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="70s"
                  value={ticksToFormattedSeconds(
                    splits[SplitType.TOB_MAIDEN_70S],
                  )}
                  href={`/raids/tob/${raidId}/maiden?tick=${splits[SplitType.TOB_MAIDEN_70S]}`}
                />
              )}
              {splits[SplitType.TOB_MAIDEN_50S] && (
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="50s"
                  value={ticksToFormattedSeconds(
                    splits[SplitType.TOB_MAIDEN_50S],
                  )}
                  href={`/raids/tob/${raidId}/maiden?tick=${splits[SplitType.TOB_MAIDEN_50S]}`}
                />
              )}
              {splits[SplitType.TOB_MAIDEN_30S] && (
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="30s"
                  value={ticksToFormattedSeconds(
                    splits[SplitType.TOB_MAIDEN_30S],
                  )}
                  href={`/raids/tob/${raidId}/maiden?tick=${splits[SplitType.TOB_MAIDEN_30S]}`}
                />
              )}
            </div>
          </div>
        </Link>
      )}

      {/*************************/
      /*  Bloat */
      /*************************/}
      {rooms.bloat && (
        <Link href={`/raids/tob/${raidId}/bloat`} className={styles.boss}>
          <div className={styles.bossImg}>
            <Image
              src="/bloat.webp"
              alt="bloat"
              fill
              style={{
                transform: 'scale(2)',
                objectFit: 'contain',
                top: display.isCompact() ? 38 : 55,
                left: display.isCompact() ? 0 : 5,
              }}
            />
          </div>
          <div className={styles.roomDetails}>
            <h4 className={styles.bossName}>
              The Pestilent Bloat
              <i className="fa-solid fa-hourglass" />
              {ticksToFormattedSeconds(splits[SplitType.TOB_BLOAT] ?? 0)}
              {rooms.bloat.deaths.length > 0 && (
                <div
                  className={styles.deathCount}
                  data-tooltip-id={GLOBAL_TOOLTIP_ID}
                  data-tooltip-content={deathsTooltip(rooms.bloat.deaths)}
                >
                  <i className="fa-solid fa-skull" />
                  {rooms.bloat.deaths.length}
                </div>
              )}
            </h4>
            <div className={styles.roomBadges}>{bloatDowns}</div>
          </div>
        </Link>
      )}

      {/*************************/
      /*  Nylos */
      /*************************/}
      {rooms.nylocas && (
        <Link href={`/raids/tob/${raidId}/nylocas`} className={styles.boss}>
          <div className={styles.bossImg}>
            <Image
              src="/nyloking.webp"
              alt="nyloking"
              fill
              style={{
                transform: 'scale(1.2)',
                objectFit: 'contain',
                top: 10,
              }}
            />
          </div>
          <div className={styles.roomDetails}>
            <h4 className={styles.bossName}>
              The Nylocas
              <i className="fa-solid fa-hourglass" />
              {ticksToFormattedSeconds(splits[SplitType.TOB_NYLO_ROOM] ?? 0)}
              {rooms.nylocas.deaths.length > 0 && (
                <div
                  className={styles.deathCount}
                  data-tooltip-id={GLOBAL_TOOLTIP_ID}
                  data-tooltip-content={deathsTooltip(rooms.nylocas.deaths)}
                >
                  <i className="fa-solid fa-skull" />
                  {rooms.nylocas.deaths.length}
                </div>
              )}
            </h4>
            <div className={styles.roomBadges}>
              {splits[SplitType.TOB_NYLO_CAP] && (
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="Cap"
                  value={ticksToFormattedSeconds(
                    splits[SplitType.TOB_NYLO_CAP],
                  )}
                  href={`/raids/tob/${raidId}/nylocas?tick=${splits[SplitType.TOB_NYLO_CAP]}`}
                />
              )}
              {splits[SplitType.TOB_NYLO_WAVES] && (
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="Last wave"
                  value={ticksToFormattedSeconds(
                    splits[SplitType.TOB_NYLO_WAVES],
                  )}
                  href={`/raids/tob/${raidId}/nylocas?tick=${splits[SplitType.TOB_NYLO_WAVES]}`}
                />
              )}
              {splits[SplitType.TOB_NYLO_CLEANUP] && (
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="Cleanup"
                  value={ticksToFormattedSeconds(
                    splits[SplitType.TOB_NYLO_CLEANUP],
                  )}
                  href={`/raids/tob/${raidId}/nylocas?tick=${splits[SplitType.TOB_NYLO_CLEANUP]}`}
                />
              )}
              {splits[SplitType.TOB_NYLO_BOSS_SPAWN] && (
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="Boss"
                  value={ticksToFormattedSeconds(
                    splits[SplitType.TOB_NYLO_BOSS_SPAWN],
                  )}
                  href={`/raids/tob/${raidId}/nylocas?tick=${splits[SplitType.TOB_NYLO_BOSS_SPAWN]}`}
                />
              )}
            </div>
            <div className={styles.roomBadges}>
              <Badge
                iconClass="fa-solid fa-dumpster-fire"
                label="Pre-cap Stalls"
                value={
                  rooms.nylocas.stalledWaves.filter((wave) => wave < 20).length
                }
                tooltipContent="Stalls occurring before the cap increase at the wave 20 spawn, when up to 12 Nylos are allowed"
              />
              <Badge
                iconClass="fa-solid fa-circle-question"
                label="Post-cap Stalls"
                value={
                  rooms.nylocas.stalledWaves.filter((wave) => wave >= 20).length
                }
                tooltipContent="Stalls occurring following the cap increase at the wave 20 spawn, when up to 24 Nylos are allowed"
              />
            </div>
          </div>
        </Link>
      )}

      {/*************************/
      /*  Sote */
      /*************************/}
      {rooms.sotetseg && (
        <Link href={`/raids/tob/${raidId}/sotetseg`} className={styles.boss}>
          <div className={styles.bossImg}>
            <Image
              src="/sote.webp"
              alt="sotetseg"
              fill
              style={{
                transform: 'scale(1.4)',
                objectFit: 'contain',
                left: 16,
              }}
            />
          </div>
          <div className={styles.roomDetails}>
            <h4 className={styles.bossName}>
              Sotetseg
              <i className="fa-solid fa-hourglass" />
              {ticksToFormattedSeconds(splits[SplitType.TOB_SOTETSEG] ?? 0)}
              {rooms.sotetseg.deaths.length > 0 && (
                <div
                  className={styles.deathCount}
                  data-tooltip-id={GLOBAL_TOOLTIP_ID}
                  data-tooltip-content={deathsTooltip(rooms.sotetseg.deaths)}
                >
                  <i className="fa-solid fa-skull" />
                  {rooms.sotetseg.deaths.length}
                </div>
              )}
            </h4>
            <div className={styles.roomBadges}>
              {splits[SplitType.TOB_SOTETSEG_66] && (
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="66%"
                  value={ticksToFormattedSeconds(
                    splits[SplitType.TOB_SOTETSEG_66],
                  )}
                  href={`/raids/tob/${raidId}/sotetseg?tick=${splits[SplitType.TOB_SOTETSEG_66]}`}
                />
              )}
              {splits[SplitType.TOB_SOTETSEG_33] && (
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="33%"
                  value={ticksToFormattedSeconds(
                    splits[SplitType.TOB_SOTETSEG_33],
                  )}
                  href={`/raids/tob/${raidId}/sotetseg?tick=${splits[SplitType.TOB_SOTETSEG_33]}`}
                />
              )}
            </div>
          </div>
        </Link>
      )}

      {/*************************/
      /*  Xarpus */
      /*************************/}
      {rooms.xarpus && (
        <Link href={`/raids/tob/${raidId}/xarpus`} className={styles.boss}>
          <div className={styles.bossImg}>
            <Image
              src="/xarpus.webp"
              alt="xarpus"
              fill
              style={{
                transform: 'scale(1.5)',
                objectFit: 'contain',
                left: 15,
              }}
            />
          </div>
          <div className={styles.roomDetails}>
            <h4 className={styles.bossName}>
              Xarpus
              <i className="fa-solid fa-hourglass" />
              {ticksToFormattedSeconds(splits[SplitType.TOB_XARPUS] ?? 0)}
              {rooms.xarpus.deaths.length > 0 && (
                <div
                  className={styles.deathCount}
                  data-tooltip-id={GLOBAL_TOOLTIP_ID}
                  data-tooltip-content={deathsTooltip(rooms.xarpus.deaths)}
                >
                  <i className="fa-solid fa-skull" />
                  {rooms.xarpus.deaths.length}
                </div>
              )}
            </h4>
            <div className={styles.roomBadges}>
              {splits[SplitType.TOB_XARPUS_EXHUMES] && (
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="Exhumes"
                  value={ticksToFormattedSeconds(
                    splits[SplitType.TOB_XARPUS_EXHUMES],
                  )}
                  href={`/raids/tob/${raidId}/xarpus?tick=${splits[SplitType.TOB_XARPUS_EXHUMES]}`}
                />
              )}
              {splits[SplitType.TOB_XARPUS_SCREECH] && (
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="Screech"
                  value={ticksToFormattedSeconds(
                    splits[SplitType.TOB_XARPUS_SCREECH],
                  )}
                  href={`/raids/tob/${raidId}/xarpus?tick=${splits[SplitType.TOB_XARPUS_SCREECH]}`}
                />
              )}
            </div>
          </div>
        </Link>
      )}

      {/*************************/
      /*  Verzik */
      /*************************/}
      {rooms.verzik && (
        <Link href={`/raids/tob/${raidId}/verzik`} className={styles.boss}>
          <div className={styles.bossImg}>
            <Image
              src="/verzik.webp"
              alt="verzik"
              fill
              style={{
                transform: 'scale(2)',
                objectFit: 'contain',
                top: 5,
                left: display.isCompact() ? 5 : 10,
              }}
            />
          </div>
          <div className={styles.roomDetails}>
            <h4 className={styles.bossName}>
              Verzik Vitur
              <i className="fa-solid fa-hourglass" />
              {ticksToFormattedSeconds(splits[SplitType.TOB_VERZIK_ROOM] ?? 0)}
              {rooms.verzik.deaths.length > 0 && (
                <div
                  className={styles.deathCount}
                  data-tooltip-id={GLOBAL_TOOLTIP_ID}
                  data-tooltip-content={deathsTooltip(rooms.verzik.deaths)}
                >
                  <i className="fa-solid fa-skull" />
                  {rooms.verzik.deaths.length}
                </div>
              )}
            </h4>
            <div className={styles.roomBadges}>
              {splits[SplitType.TOB_VERZIK_P1_END] && (
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="P1"
                  value={ticksToFormattedSeconds(
                    splits[SplitType.TOB_VERZIK_P1_END],
                  )}
                  href={`/raids/tob/${raidId}/verzik?tick=${splits[SplitType.TOB_VERZIK_P1_END]}`}
                />
              )}
              {splits[SplitType.TOB_VERZIK_REDS] && (
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="Reds"
                  value={ticksToFormattedSeconds(
                    splits[SplitType.TOB_VERZIK_REDS],
                  )}
                  href={`/raids/tob/${raidId}/verzik?tick=${splits[SplitType.TOB_VERZIK_REDS]}`}
                />
              )}
              {splits[SplitType.TOB_VERZIK_P2_END] && (
                <Badge
                  iconClass="fa-solid fa-hourglass"
                  label="P2"
                  value={ticksToFormattedSeconds(
                    splits[SplitType.TOB_VERZIK_P2_END],
                  )}
                  href={`/raids/tob/${raidId}/verzik?tick=${splits[SplitType.TOB_VERZIK_P2_END]}`}
                />
              )}
            </div>
          </div>
        </Link>
      )}
    </div>
  );
}
