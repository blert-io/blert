import { getActiveLinkingCode, getDiscordLinkStatus } from '@/actions/users';

import Card from '@/components/card';

import DiscordLinkingSection from './discord-linking-section';

import styles from '../style.module.scss';

export default async function LinkedAccountsSettings({
  searchParams,
}: {
  searchParams: Promise<{ generate?: string }>;
}) {
  const [linkStatus, activeLinkingCode] = await Promise.all([
    getDiscordLinkStatus(),
    getActiveLinkingCode(),
  ]);
  const params = await searchParams;
  const autoGenerate = params.generate === 'discord';

  return (
    <>
      <Card className={styles.header} primary>
        <h1>Linked Accounts</h1>
        <p className={styles.description}>
          Connect external accounts to unlock special Blert integrations.
        </p>
      </Card>

      <DiscordLinkingSection
        initialStatus={linkStatus}
        initialLinkingCode={activeLinkingCode}
        autoGenerate={autoGenerate}
      />
    </>
  );
}

export const metadata = {
  title: 'Linked Accounts',
  description: 'Link your Discord account to Blert.',
};

export const dynamic = 'force-dynamic';
