'use client';

import {
  ChallengeType,
  ColosseumChallenge,
  ColosseumWave,
} from '@blert/common';
import Link from 'next/link';
import Image from 'next/image';
import { useContext } from 'react';

import ColosseumHandicap from '../../../../components/colosseum-handicap';
import { RaidQuickDetails } from '../../../../components/raid-quick-details/raid-quick-details';
import { RaidTeamPanel } from '../../../../components/raid-team/raid-team';
import PvMContentLogo, {
  PvMContent,
} from '../../../../components/pvm-content-logo';
import Loading from '../../../../components/loading';
import { DisplayContext } from '../../../../display';
import { ticksToFormattedSeconds } from '../../../../utils/tick';
import { challengeUrl } from '../../../../utils/url';

import styles from './style.module.scss';
import { ChallengeContext } from '@/challenge-context';

type WaveProps = {
  id: string;
  number: number;
  wave: ColosseumWave;
};

function Wave(props: WaveProps) {
  const url = challengeUrl(ChallengeType.COLOSSEUM, props.id);

  const title = props.number === 12 ? 'Sol Heredit' : `Wave ${props.number}`;

  return (
    <Link
      className={styles.wave}
      href={`${url}/waves/${props.number}`}
      style={{ color: props.number === 12 ? '#b07825' : undefined }}
    >
      <h2>{title}</h2>
      <span className={styles.time}>
        <i
          className="fa-solid fa-hourglass"
          style={{ position: 'relative', left: '4px' }}
        />
        {ticksToFormattedSeconds(props.wave.ticks)}
      </span>
      <ul className={styles.handicapOptions}>
        {props.wave.options.map((option) => (
          <ColosseumHandicap
            key={option}
            handicap={option}
            dimmed={option !== props.wave.handicap}
          />
        ))}
      </ul>
      <Image
        src={`/images/colosseum/wave-${props.number}.webp`}
        alt={title}
        width={200}
        height={80}
        style={{ objectFit: 'contain' }}
      />
    </Link>
  );
}

export default function Overview() {
  const [challenge] = useContext(ChallengeContext) as [
    ColosseumChallenge | null,
    unknown,
  ];
  const display = useContext(DisplayContext);

  if (challenge === null) {
    return <Loading />;
  }

  const playersWithGear = challenge.party.map((player, i) => {
    return {
      name: player,
      currentUsername: challenge.partyInfo[i].currentUsername,
      primaryMeleeGear: challenge.partyInfo[i].gear,
    };
  });

  return (
    <div className={styles.colosseum}>
      <PvMContentLogo
        pvmContent={PvMContent.Colosseum}
        height={200}
        width={380}
      />
      <RaidQuickDetails
        type={challenge.type}
        stage={challenge.stage}
        status={challenge.status}
        mode={challenge.mode}
        totalRaidTicks={challenge.totalTicks}
        deaths={challenge.totalDeaths}
        partySize={challenge.party.length}
        startTime={challenge.startTime}
      />
      <div className={styles.handicaps}>
        <ul>
          {challenge.colosseum.handicaps.map((handicap, i) => (
            <li key={i}>
              <ColosseumHandicap handicap={handicap} />
            </li>
          ))}
        </ul>
      </div>
      <RaidTeamPanel
        players={playersWithGear}
        compactView={display.isCompact()}
      />
      <div className={styles.waves}>
        {challenge.colosseum.waves.map((wave, i) => (
          <Wave key={i} id={challenge._id} number={i + 1} wave={wave} />
        ))}
      </div>
    </div>
  );
}
