import {
  ChallengeType,
  ColosseumChallenge,
  ColosseumWave,
  SplitType,
} from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';

import ColosseumHandicap from '@/components/colosseum-handicap';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl } from '@/utils/url';

import styles from './style.module.scss';

interface WaveProps {
  challengeId: string;
  ticks: number;
  wave: ColosseumWave;
  waveNumber: number;
}

function Wave({ challengeId, ticks, wave, waveNumber }: WaveProps) {
  const title = waveNumber === 12 ? 'Sol Heredit' : `Wave ${waveNumber}`;

  return (
    <Link
      href={`${challengeUrl(ChallengeType.COLOSSEUM, challengeId)}/waves/${waveNumber}`}
      className={styles.wave}
    >
      <div className={styles.waveImg}>
        <Image
          src={`/images/colosseum/wave-${waveNumber}.webp`}
          alt={title}
          fill
          style={{
            objectFit: 'contain',
          }}
        />
      </div>
      <div className={styles.waveDetails}>
        <div className={styles.waveHeader}>
          {title}
          <div className={styles.time}>
            <i className="fas fa-hourglass" />
            {ticksToFormattedSeconds(ticks)}
          </div>
        </div>
        <div className={styles.handicaps}>
          <h4>Selected Handicap</h4>
          <ul>
            {wave.options.map((handicap) => (
              <ColosseumHandicap
                key={handicap}
                handicap={handicap}
                dimmed={handicap !== wave.handicap}
              />
            ))}
          </ul>
        </div>
      </div>
    </Link>
  );
}

export function ColosseumWavesOverview({
  challenge,
}: {
  challenge: ColosseumChallenge;
}) {
  return (
    <div className={styles.wavesOverview}>
      <h2>Wave Progress</h2>
      <div className={styles.waves}>
        {challenge.colosseum.waves.map((wave, index) => (
          <Wave
            key={index}
            challengeId={challenge.uuid}
            ticks={
              challenge.splits[
                (SplitType.COLOSSEUM_WAVE_1 + index) as SplitType
              ] ?? 0
            }
            wave={wave}
            waveNumber={index + 1}
          />
        ))}
      </div>
    </div>
  );
}
