import { ChallengeType, MokhaiotlChallenge } from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';

import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl } from '@/utils/url';

import styles from './style.module.scss';

interface DelveProps {
  challengeId: string;
  ticks: number;
  delveNumber: number;
}

function Delve({ challengeId, ticks, delveNumber }: DelveProps) {
  const title = `Delve ${delveNumber}`;

  return (
    <Link
      href={`${challengeUrl(ChallengeType.MOKHAIOTL, challengeId)}/delves/${delveNumber}`}
      className={styles.delve}
    >
      <div className={styles.delveImg}>
        <Image
          src="/images/mokhaiotl.webp"
          alt={title}
          fill
          style={{
            objectFit: 'contain',
          }}
        />
      </div>
      <div className={styles.delveDetails}>
        <div className={styles.delveHeader}>
          {title}
          <div className={styles.time}>
            <i className="fas fa-hourglass" />
            {ticksToFormattedSeconds(ticks)}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function DelvesOverview({
  challenge,
}: {
  challenge: MokhaiotlChallenge;
}) {
  return (
    <div className={styles.delvesOverview}>
      <h2>Delve Progress</h2>
      <div className={styles.delves}>
        {challenge.mokhaiotl.delves.map((delve, index) => (
          <Delve
            key={index}
            challengeId={challenge.uuid}
            ticks={delve.challengeTicks}
            delveNumber={delve.delve}
          />
        ))}
      </div>
    </div>
  );
}
