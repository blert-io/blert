'use client';

import { ChallengeType, HANDICAP_LEVEL_VALUE_INCREMENT } from '@blert/common';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useContext, useEffect } from 'react';

import Loading from '../../../../../components/loading';
import { ColosseumContext } from '../../../context';
import { ticksToFormattedSeconds } from '../../../../../utils/tick';
import { challengeUrl } from '../../../../../utils/url';

import styles from './style.module.scss';
import ColosseumHandicap from '../../../../../components/colosseum-handicap';

function imageForWave(waveNumber: number) {
  switch (waveNumber) {
    case 1:
      return '/images/colosseum/serpent-shaman.webp';
    case 2:
    case 3:
      return '/images/colosseum/javelin-colossus.webp';
    case 4:
    case 5:
    case 9:
    case 10:
    case 11:
      return '/images/colosseum/manticore.webp';
    case 6:
      return '/images/colosseum/jaguar-warrior.webp';
    case 7:
    case 8:
      return '/images/colosseum/shockwave-colossus.webp';
    case 12:
    default:
      return '/images/colosseum/sol-heredit.webp';
  }
}

type ColosseumWavePageProps = {
  params: { id: string; number: string };
};

export default function ColosseumWavePage({
  params: { id: challengeId, number },
}: ColosseumWavePageProps) {
  const router = useRouter();

  const challenge = useContext(ColosseumContext);

  const waveNumber = Number.parseInt(number, 10);
  useEffect(() => {
    if (isNaN(waveNumber) || waveNumber < 1 || waveNumber > 12) {
      router.replace(challengeUrl(ChallengeType.COLOSSEUM, challengeId));
    }
  }, [waveNumber]);

  if (challenge === null) {
    return <Loading />;
  }

  const waveInfo = challenge.colosseum.waves[waveNumber - 1];
  if (waveInfo === undefined) {
    // TODO(frolv): Proper missing wave page.
    return <div>No data for wave {waveNumber}.</div>;
  }

  const title = waveNumber === 12 ? 'Sol Heredit' : `Wave ${waveNumber}`;

  // Collect all the handicaps that have been selected up to this wave.
  const handicapsSoFar = [];
  for (let i = 0; i < waveNumber; i++) {
    const handicap = challenge.colosseum.waves[i].handicap;
    const index: number = handicapsSoFar.findIndex(
      (h) => h === handicap || h == handicap - HANDICAP_LEVEL_VALUE_INCREMENT,
    );
    if (index === -1) {
      handicapsSoFar.push(handicap);
    } else {
      handicapsSoFar[index] = handicap;
    }
  }

  return (
    <div className={styles.wavePage}>
      <div className={styles.waveOverview}>
        <div className={styles.waveImage}>
          <Image
            src={imageForWave(waveNumber)}
            alt={`Fortis Colosseum Wave ${waveNumber}`}
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
        <div className={styles.waveDetails}>
          <h2>
            {title} ({ticksToFormattedSeconds(waveInfo.ticks)})
          </h2>
          <div className={styles.handicaps}>
            <h3>Handicaps This Wave</h3>
            <ul>
              {waveInfo.options.map((option) => (
                <li key={option}>
                  <ColosseumHandicap
                    handicap={option}
                    dimmed={option !== waveInfo.handicap}
                  />
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.handicaps}>
            <h3>All Active Handicaps</h3>
            <ul>
              {handicapsSoFar.map((handicap) => (
                <li key={handicap}>
                  <ColosseumHandicap handicap={handicap} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
