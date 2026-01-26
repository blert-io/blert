import Link from 'next/link';

import styles from './onboarding-card.module.scss';

const DISCORD_INVITE_URL = 'https://discord.gg/c5Hgv3NnYe';

type OnboardingCardProps = {
  username: string;
};

export default function OnboardingCard({ username }: OnboardingCardProps) {
  return (
    <div className={styles.onboarding}>
      <div className={styles.header}>
        <h1>Welcome to Blert, {username}</h1>
        <p className={styles.subtitle}>
          Link your account to start tracking your raids
        </p>
      </div>

      <div className={styles.steps}>
        <div className={styles.step}>
          <div className={styles.stepNumber}>1</div>
          <div className={styles.stepContent}>
            <h3>Join the Discord</h3>
            <p>
              Join our Discord server and run{' '}
              <code className={styles.command}>/link-discord</code> to connect
              your account.
            </p>
            <a
              href={DISCORD_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.discordLink}
            >
              <i className="fab fa-discord" />
              Join Discord
            </a>
          </div>
        </div>

        <div className={styles.step}>
          <div className={styles.stepNumber}>2</div>
          <div className={styles.stepContent}>
            <h3>Get Plugin Access</h3>
            <p>
              Once verified, ask a{' '}
              <strong style={{ color: '#e91e63' }}>@Support</strong> member in
              Discord to grant API key access.
            </p>
          </div>
        </div>

        <div className={styles.step}>
          <div className={styles.stepNumber}>3</div>
          <div className={styles.stepContent}>
            <h3>Create an API Key</h3>
            <p>
              Generate an API key in settings and paste it into the Blert
              RuneLite plugin.
            </p>
            <Link href="/settings/api-keys" className={styles.settingsLink}>
              <i className="fas fa-key" />
              Go to Settings
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
