import { notFound, redirect } from 'next/navigation';

import { getSetupByPublicId } from '@/actions/setup';
import { getSignedInUser } from '@/actions/users';

import LocalSetupLoader from './local-setup-loader';
import GearSetupsCreator from './setup-creator';
import { SetupViewingContextProvider } from '../../viewing-context';

import styles from './style.module.scss';

export default async function GearSetupsEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (id.startsWith('local-')) {
    return <LocalSetupLoader id={id} />;
  }

  const user = await getSignedInUser();
  if (user === null) {
    redirect(`/login?next=/setups/${id}/edit`);
  }

  const setup = await getSetupByPublicId(id, true);
  if (setup === null) {
    notFound();
  }

  // Only allow editing if user is the author.
  if (setup.authorId !== user.id) {
    redirect(`/setups/${id}`);
  }

  return (
    <SetupViewingContextProvider>
      <div className={styles.setupsPage}>
        <GearSetupsCreator setup={setup} />
      </div>
    </SetupViewingContextProvider>
  );
}
