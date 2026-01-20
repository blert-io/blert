import bcrypt from 'bcrypt';
import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { PostgresJSDialect } from 'kysely-postgres-js';

import { sendPasswordResetEmail, sendVerificationEmail } from './email/send';
import { sql } from './actions/db';

const SALT_ROUNDS = 10;

export const auth = betterAuth({
  database: {
    dialect: new PostgresJSDialect({
      postgres: sql,
    }),
    type: 'postgres',
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
      displayUsername: 'display_username',
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
          console.error('Failed to send reset password email:', e);
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
        console.error('Failed to send verification email:', e);
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
    nextCookies(),
  ],
});
