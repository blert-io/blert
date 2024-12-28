import { redirect } from 'next/navigation';

import { getSignedInUser } from '@/actions/users';

import GearSetupsCreator from './setup-creator';

import styles from './style.module.scss';

export default async function GearSetupsCreationPage() {
  const user = await getSignedInUser();
  if (user === null) {
    redirect('/login?next=/setups/create');
  }

  return (
    <div className={styles.setupsPage}>
      <GearSetupsCreator />
    </div>
  );
}
