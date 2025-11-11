import { redirect } from 'next/navigation';

import { newGearSetup } from '@/actions/setup';
import { getSignedInUser } from '@/actions/users';

import { AnonymousSetupCreator } from './anonymous-setup-creator';

export default async function GearSetupsCreationRedirect() {
  const user = await getSignedInUser();
  if (user !== null) {
    const newSetup = await newGearSetup(user);
    redirect(`/setups/${newSetup.publicId}/edit`);
  }

  return <AnonymousSetupCreator />;
}
