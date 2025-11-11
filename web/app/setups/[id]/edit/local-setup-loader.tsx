'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { SetupMetadata } from '@/actions/setup';
import Loading from '@/components/loading';

import { setupLocalStorage } from '../../local-storage';
import GearSetupsCreator from './setup-creator';
import { SetupViewingContextProvider } from '../../viewing-context';

import styles from './style.module.scss';

export default function LocalSetupLoader({ id }: { id: string }) {
  const router = useRouter();

  const [setup, setSetup] = useState<SetupMetadata | null>(null);

  useEffect(() => {
    const localSetup = setupLocalStorage.loadSetup(id);
    if (localSetup === null) {
      router.replace('/setups');
      return;
    }
    setSetup(localSetup);
  }, [id, router]);

  if (setup === null) {
    return <Loading />;
  }

  return (
    <SetupViewingContextProvider>
      <div className={styles.setupsPage}>
        <GearSetupsCreator setup={setup} />
      </div>
    </SetupViewingContextProvider>
  );
}
