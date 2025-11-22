import { getSignedInUser } from '@/actions/users';
import { getUserAccount } from '@/actions/blertbank';

import BalanceSection from './balance-section';

export default async function BlertcoinSettings() {
  const user = await getSignedInUser();
  if (user === null) {
    return null;
  }

  const account = await getUserAccount();

  return (
    <>
      <BalanceSection account={account} />
    </>
  );
}

export const metadata = {
  title: 'Blertcoin',
  description: 'Manage your Blertcoin balance and transaction history.',
};

export const dynamic = 'force-dynamic';
