import bcrypt from 'bcrypt';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { customSession, username } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { headers } from 'next/headers';
import { cache } from 'react';

import logger from '@/utils/log';

import { sendPasswordResetEmail, sendVerificationEmail } from './email/send';
import { connectedPlayersCache } from './actions/connected-players';
import { sql } from './actions/db';

const SALT_ROUNDS = 10;

const options = {
  database: {
    dialect: new PostgresJSDialect({
      postgres: sql,
    }),
    type: 'postgres',
  },
  logger: {
    log: (level, message, ...args) => {
      logger.log(level, 'better_auth', {
        detail: message,
        args:
          args.length > 0
            ? args.map((arg: unknown) =>
                arg instanceof Error
                  ? { message: arg.message, stack: arg.stack }
                  : arg,
              )
            : undefined,
      });
    },
  },
  rateLimit: {
    window: 60,
    max: 100,
    customRules: {
      '/send-verification-email': {
        window: 60,
        max: 3,
      },
      '/request-password-reset': {
        window: 60,
        max: 3,
      },
      '/change-email': {
        window: 60,
        max: 3,
      },
    },
  },
  advanced: {
    database: {
      generateId: 'serial',
    },
  },
  user: {
    modelName: 'users',
    fields: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      emailVerified: 'email_verified',
      name: 'display_username',
    },
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: true,
    },
  },
  account: {
    modelName: 'account',
    fields: {
      userId: 'user_id',
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      idToken: 'id_token',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  session: {
    modelName: 'session',
    fields: {
      userId: 'user_id',
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    cookieCache: {
      enabled: true,
      maxAge: 60,
      strategy: 'compact',
    },
  },
  verification: {
    modelName: 'verification',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 96,
    password: {
      hash: (pw) => bcrypt.hash(pw, SALT_ROUNDS),
      verify: ({ hash, password }) => bcrypt.compare(password, hash),
    },
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: ({ user, url }) => {
      if (user.emailVerified) {
        void sendPasswordResetEmail(user.email, url).catch((e) => {
          logger.error('email_send_failed', {
            type: 'reset_password',
            error: e instanceof Error ? e.message : String(e),
          });
        });
      }
      return Promise.resolve();
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: ({ user, url }) => {
      // Don't block on email sending.
      void sendVerificationEmail(user.email, url).catch((e) => {
        logger.error('email_send_failed', {
          type: 'verification',
          error: e instanceof Error ? e.message : String(e),
        });
      });
      return Promise.resolve();
    },
  },
  plugins: [
    username({
      minUsernameLength: 2,
      maxUsernameLength: 24,
      usernameValidator: (username) => /^[a-zA-Z0-9_-]{2,24}$/.test(username),
      schema: {
        user: {
          fields: {
            displayUsername: 'display_username',
          },
        },
      },
    }),
  ],
} satisfies BetterAuthOptions;

export const auth = betterAuth({
  ...options,
  plugins: [
    ...options.plugins,
    customSession(
      async ({ user, session }) => ({
        user,
        session,
        connectedPlayers: await connectedPlayersCache.get(
          parseInt(user.id, 10),
        ),
      }),
      options,
    ),
    // nextCookies must be the last plugin.
    nextCookies(),
  ],
});

/** Returns the current request's session, or `null` if signed out. */
export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);
