import { redirect } from 'next/navigation';

import { getSignedInUser, getUserSettings } from '@/actions/users';
import Card from '@/components/card';

import ApiKeysSection from './api-keys-section';
import PasswordSection from './password-section';

import styles from './style.module.scss';

export default async function Settings() {
  const user = await getSignedInUser();
  if (user === null) {
    redirect('/login?next=/settings');
  }

  const settings = await getUserSettings();

  return (
    <div className={styles.settings}>
      <div className={styles.settingsInner}>
        <Card className={styles.header} primary>
          <h1>Account Settings</h1>
          <div className={styles.accountInfo}>
            <div className={styles.field}>
              <label>Username</label>
              <div className={styles.value}>
                {user.username}
                <span className={styles.memberSince}>
                  Member since {user.createdAt.toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        </Card>

        <PasswordSection />

        <ApiKeysSection initialApiKeys={settings.apiKeys} />
      </div>
    </div>
  );
}

export const metadata = {
  title: 'Account Settings',
  description: 'Manage your Blert account settings and API keys.',
};

export const dynamic = 'force-dynamic';
