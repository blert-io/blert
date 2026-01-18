import Image from 'next/image';
import Link from 'next/link';

import Card from '@/components/card';
import { MAIN_LOGO } from '@/logo';

import SessionRefresh from './session-refresh';

import layoutStyles from './style.module.scss';
import styles from './verification-result.module.scss';

type Display = {
  title: string;
  message: string;
  link: { href: string; label: string; icon: string };
};

type VerificationResultProps = {
  success?: Display;
  error?: Display;
  refreshSession?: boolean;
};

export default function VerificationResult({
  success,
  error,
  refreshSession = false,
}: VerificationResultProps) {
  let display: Display;
  let icon: string;

  if (success !== undefined) {
    display = success;
    icon = `fas fa-check-circle ${styles.successIcon}`;
  } else if (error !== undefined) {
    display = error;
    icon = `fas fa-exclamation-circle ${styles.errorIcon}`;
  } else {
    return null;
  }

  return (
    <div className={styles.verifyEmail}>
      {refreshSession && <SessionRefresh />}
      <Card className={styles.content}>
        <Image
          src={MAIN_LOGO}
          alt="Blert Logo"
          width={100}
          height={100}
          style={{ objectFit: 'contain' }}
        />
        <h1>
          <i className={icon} />
          {display.title}
        </h1>
        <p>{display.message}</p>
        <Link href={display.link.href} className={layoutStyles.actionButton}>
          <i className={display.link.icon} />
          {display.link.label}
        </Link>
      </Card>
    </div>
  );
}
