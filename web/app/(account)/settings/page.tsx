import { redirect } from 'next/navigation';

import { getApiKeys, getSignedInUser } from '@/actions/users';

import ApiKeyPanel from './api-key-panel';

import styles from './style.module.scss';

export default async function Settings() {
  const user = await getSignedInUser();
  if (user === null) {
    redirect('/login');
  }

  const apiKeys = await getApiKeys();

  return (
    <div className={styles.settings}>
      <div className={styles.panel}>
        <h2>Account</h2>
        <div>{user.username}</div>
        <div>
          Member since{' '}
          {user._id.getTimestamp().toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
          })}
        </div>
      </div>

      <div className={`${styles.panel} ${styles.apiKeys}`}>
        <ApiKeyPanel
          initialApiKeys={apiKeys.map((apiKey) => {
            const { _id, ...rest } = apiKey;
            return { ...rest, _id: _id.toString() };
          })}
        />
      </div>
    </div>
  );
}

export const metadata = {
  title: 'Settings',
  description: 'Manage your account settings',
};
