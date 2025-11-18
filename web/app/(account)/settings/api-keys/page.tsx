import { getUserSettings } from '@/actions/users';

import ApiKeysSection from './api-keys-section';

export default async function ApiKeysSettings() {
  const settings = await getUserSettings();

  return <ApiKeysSection initialApiKeys={settings.apiKeys} />;
}

export const metadata = {
  title: 'API Keys',
  description: 'Manage your Blert API keys.',
};

export const dynamic = 'force-dynamic';
