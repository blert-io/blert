'use server';

import {
  BlertbankClient,
  UserAccount,
  BlertbankError,
  UnauthorizedError,
} from '@blert/blertbank-client';

import logger from '@/utils/log';
import { withServerAction } from '@/utils/metrics';

import { AuthenticationError } from './errors';
import { getSignedInUserId } from './users';

/**
 * Ensures the user is authenticated and returns their user ID.
 * @throws Error if not authenticated or user ID is invalid.
 */
async function ensureAuthenticated(): Promise<number> {
  const userId = await getSignedInUserId();
  if (userId === null) {
    throw new AuthenticationError();
  }
  return userId;
}

/**
 * Initialize the Blertbank client with environment configuration.
 */
function getBlertbankClient(): BlertbankClient {
  const baseUrl = process.env.BLERTBANK_BASE_URL;
  const serviceToken = process.env.BLERTBANK_SERVICE_TOKEN;

  if (!baseUrl) {
    throw new Error('BLERTBANK_BASE_URL is not configured');
  }
  if (!serviceToken) {
    throw new Error('BLERTBANK_SERVICE_TOKEN is not configured');
  }

  return new BlertbankClient({
    baseUrl,
    serviceToken,
    serviceName: 'web-app',
  });
}

/**
 * Gets the Blertcoin balance for the current user.
 * Creates an account with 0 balance if the user doesn't have one yet.
 *
 * @returns The user's current Blertcoin balance.
 * @throws Error no user is authenticated or the request fails.
 */
export async function getUserBalance(): Promise<number> {
  return withServerAction('getUserBalance', async () => {
    const userId = await ensureAuthenticated();
    const client = getBlertbankClient();

    try {
      const balance = await client.getOrCreateBalance(userId);
      return balance;
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        logger.error('blertbank_auth_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error('Service configuration error');
      }

      if (error instanceof BlertbankError) {
        logger.error('blertbank_error', {
          userId,
          method: 'getOrCreateBalance',
          error: error instanceof Error ? error.message : String(error),
        });
        // Return 0 for non-critical errors to degrade gracefully.
        return 0;
      }

      logger.error('blertbank_unexpected_error', {
        userId,
        method: 'getOrCreateBalance',
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  });
}

/**
 * Gets the full account information for the current user.
 * Creates an account if the user doesn't have one yet.
 *
 * @returns The user's Blertcoin account details.
 * @throws Error no user is authenticated or the request fails.
 */
export async function getUserAccount(): Promise<UserAccount | null> {
  return withServerAction('getUserAccount', async () => {
    const userId = await ensureAuthenticated();
    const client = getBlertbankClient();

    try {
      const account = await client.getOrCreateAccountForUser(userId);
      return account;
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        logger.error('blertbank_auth_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error('Service configuration error');
      }

      if (error instanceof BlertbankError) {
        logger.error('blertbank_error', {
          userId,
          method: 'getOrCreateAccountForUser',
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }

      logger.error('blertbank_unexpected_error', {
        userId,
        method: 'getOrCreateAccountForUser',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  });
}
