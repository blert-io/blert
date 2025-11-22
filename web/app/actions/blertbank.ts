'use server';

import {
  BlertbankClient,
  UserAccount,
  BlertbankError,
  UnauthorizedError,
} from '@blert/blertbank-client';

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
  const userId = await ensureAuthenticated();
  const client = getBlertbankClient();

  try {
    const balance = await client.getOrCreateBalance(userId);
    return balance;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      console.error('Blertbank authorization failed:', error);
      throw new Error('Service configuration error');
    }

    if (error instanceof BlertbankError) {
      console.error('Failed to fetch balance for user', userId, error);
      // Return 0 for non-critical errors to degrade gracefully.
      return 0;
    }

    console.error('Unexpected error fetching balance:', error);
    return 0;
  }
}

/**
 * Gets the full account information for the current user.
 * Creates an account if the user doesn't have one yet.
 *
 * @returns The user's Blertcoin account details.
 * @throws Error no user is authenticated or the request fails.
 */
export async function getUserAccount(): Promise<UserAccount | null> {
  const userId = await ensureAuthenticated();
  const client = getBlertbankClient();

  try {
    const account = await client.getOrCreateAccountForUser(userId);
    return account;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      console.error('Blertbank authorization failed:', error);
      throw new Error('Service configuration error');
    }

    if (error instanceof BlertbankError) {
      console.error('Failed to fetch account for user', userId, error);
      return null;
    }

    console.error('Unexpected error fetching account:', error);
    return null;
  }
}
