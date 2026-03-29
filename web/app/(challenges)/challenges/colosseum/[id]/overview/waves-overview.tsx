import {
  ChallengeType,
  ColosseumChallenge,
  ColosseumWave,
  isColosseumStage,
  SplitType,
  Stage,
} from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';

import { useLiveChallenge } from '@/challenge-context';
import ColosseumHandicap from '@/components/colosseum-handicap';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl } from '@/utils/url';

import styles from './style.module.scss';

interface WaveProps {
  challengeId: string;
  ticks?: number;
  wave?: ColosseumWave;
  waveNumber: number;
  live?: boolean;
}

function Wave({ challengeId, ticks, wave, waveNumber, live }: WaveProps) {
  const title = waveNumber === 12 ? 'Sol Heredit' : `Wave ${waveNumber}`;

  return (
    <Link
      href={`${challengeUrl(ChallengeType.COLOSSEUM, challengeId)}/waves/${waveNumber}`}
      className={styles.wave}
    >
      <div className={styles.waveImg}>
        <Image
          src={
            waveNumber === 12
              ? '/images/colosseum/sol-heredit.webp'
              : `/images/colosseum/wave-${waveNumber}.webp`
          }
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
          {live ? (
            <div className={styles.liveBadge}>
              <span className={styles.liveDot} />
              LIVE
            </div>
          ) : (
            <div className={styles.time}>
              <i className="fas fa-hourglass" />
              {ticksToFormattedSeconds(ticks ?? 0)}
            </div>
          )}
        </div>
        {wave && (
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
        )}
      </div>
    </Link>
  );
}

export function ColosseumWavesOverview({
  challenge,
}: {
  challenge: ColosseumChallenge;
}) {
  const { currentStage, isStreaming, liveSplits } = useLiveChallenge();
  const splits = { ...liveSplits, ...challenge.splits };

  const liveStage =
    currentStage?.stage && isStreaming ? currentStage.stage : null;

  const processedWaves = challenge.colosseum.waves.length;
  const liveWaveNumber =
    liveStage !== null && isColosseumStage(liveStage)
      ? liveStage - Stage.COLOSSEUM_WAVE_1 + 1
      : null;

  const showLiveWave =
    liveWaveNumber !== null && liveWaveNumber > processedWaves;

  return (
    <div className={styles.wavesOverview}>
      <h2>Wave Progress</h2>
      <div className={styles.waves}>
        {challenge.colosseum.waves.map((wave, index) => (
          <Wave
            key={index}
            challengeId={challenge.uuid}
            ticks={
              splits[(SplitType.COLOSSEUM_WAVE_1 + index) as SplitType] ?? 0
            }
            wave={wave}
            waveNumber={index + 1}
          />
        ))}
        {showLiveWave && (
          <Wave
            key="live"
            challengeId={challenge.uuid}
            waveNumber={liveWaveNumber}
            live
          />
        )}
      </div>
    </div>
  );
}
