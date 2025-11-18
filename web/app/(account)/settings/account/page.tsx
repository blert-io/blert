import { getSignedInUser } from '@/actions/users';
import Card from '@/components/card';

import PasswordSection from './password-section';

import styles from '../style.module.scss';

export default async function AccountSettings() {
  const user = await getSignedInUser();
  if (user === null) {
    return null;
  }

  return (
    <>
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
    </>
  );
}

export const metadata = {
  title: 'Account Settings',
  description: 'Manage your Blert account settings.',
};

export const dynamic = 'force-dynamic';
