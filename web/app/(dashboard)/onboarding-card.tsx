import { ButtonLink } from '@/components/button';

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
          Get the plugin and generate an API key to start tracking your raids
        </p>
      </div>

      <div className={styles.steps}>
        <div className={styles.step}>
          <div className={styles.stepNumber}>1</div>
          <div className={styles.stepContent}>
            <h3>Get the Plugin</h3>
            <p>
              Install the Blert plugin from the RuneLite Plugin Hub if you
              haven&apos;t already.
            </p>
            <ButtonLink
              href="https://runelite.net/plugin-hub/show/blert"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.settingsLink}
              fontSize="0.85rem"
              simple
            >
              <i className="fas fa-external-link-alt" />
              Get Plugin
            </ButtonLink>
          </div>
        </div>

        <div className={styles.step}>
          <div className={styles.stepNumber}>2</div>
          <div className={styles.stepContent}>
            <h3>Create an API Key</h3>
            <p>
              Generate an API key in settings and paste it into the Blert
              RuneLite plugin.
            </p>
            <ButtonLink
              href="/settings/api-keys"
              className={styles.settingsLink}
              fontSize="0.85rem"
              simple
            >
              <i className="fas fa-key" />
              Go to Settings
            </ButtonLink>
          </div>
        </div>

        <div className={styles.step}>
          <div className={styles.stepNumber}>3</div>
          <div className={styles.stepContent}>
            <h3>
              Link Discord{' '}
              <span className={styles.optionalBadge}>Optional</span>
            </h3>
            <p>
              Join our Discord server and link your account for support,
              announcements, and our Discord bot.
            </p>
            <ButtonLink
              href={DISCORD_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.discordLink}
              fontSize="0.85rem"
            >
              <i className="fab fa-discord" />
              Join Discord
            </ButtonLink>
          </div>
        </div>
      </div>
    </div>
  );
}
