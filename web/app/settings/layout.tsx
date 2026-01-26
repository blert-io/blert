import { redirect } from 'next/navigation';

import { getSignedInUser } from '@/actions/users';

import SettingsTabs from './settings-tabs';

import styles from './style.module.scss';

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSignedInUser();
  if (user === null) {
    redirect('/login?next=/settings');
  }

  return (
    <div className={styles.settings}>
      <div className={styles.settingsInner}>
        <SettingsTabs />
        {children}
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';
