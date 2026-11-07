import { createAuthClient } from 'better-auth/react';
import {
  customSessionClient,
  usernameClient,
} from 'better-auth/client/plugins';

import type { auth } from './auth';

export const authClient = createAuthClient({
  plugins: [usernameClient(), customSessionClient<typeof auth>()],
});
