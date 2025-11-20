import Image from 'next/image';

import styles from './style.module.scss';

type ChallengeLoadErrorProps = {
  message: string;
  details?: string;
  logoSrc?: string;
  logoAlt?: string;
};

export default function ChallengeLoadError({
  message,
  details,
  logoSrc,
  logoAlt = 'Challenge logo',
}: ChallengeLoadErrorProps) {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        {logoSrc ? (
          <div className={styles.logo}>
            <Image src={logoSrc} alt={logoAlt} width={128} height={104} />
          </div>
        ) : null}
        <p className={styles.message}>{message}</p>
        {details ? <p className={styles.details}>{details}</p> : null}
      </div>
    </div>
  );
}
