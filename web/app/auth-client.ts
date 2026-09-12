import { createAuthClient } from 'better-auth/react';
import {
  customSessionClient,
  usernameClient,
} from 'better-auth/client/plugins';

import type { auth } from './auth';

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BASE_URL,
  plugins: [usernameClient(), customSessionClient<typeof auth>()],
});
