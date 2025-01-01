import { redirect } from 'next/navigation';

import { newGearSetup } from '@/actions/setup';
import { getSignedInUser } from '@/actions/users';

export default async function GearSetupsCreationRedirect() {
  const user = await getSignedInUser();
  if (user === null) {
    redirect('/login?next=/setups/create');
  }

  const newSetup = await newGearSetup(user);

  redirect(`/setups/${newSetup.publicId}/edit`);
}
