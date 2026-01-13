'use server';

import { isPostgresUniqueViolation, User } from '@blert/common';

import { sql } from './db';
import redis from './redis';

type LinkedUser = Pick<
  User,
  'id' | 'username' | 'discordId' | 'discordUsername'
>;

export type VerifyLinkResult =
  | {
      success: true;
      user: LinkedUser;
    }
  | {
      success: false;
      error:
        | 'invalid_code'
        | 'expired'
        | 'conflict'
        | 'user_not_found'
        | 'internal_error';
    };

/**
 * Verifies a Discord linking code and links the Discord account to the Blert
 * user.
 *
 * @param code The 8-character linking code
 * @param discordId The Discord user ID
 * @param discordUsername The Discord username
 * @returns Result object with user data on success or error on failure
 */
export async function verifyDiscordLink(
  code: string,
  discordId: string,
  discordUsername: string,
): Promise<VerifyLinkResult> {
  const linkingCodeResult = await sql<{ user_id: number; expires_at: Date }[]>`
    SELECT user_id, expires_at
    FROM account_linking_codes
    WHERE code = ${code}
    AND type = 'discord'
  `;

  if (linkingCodeResult.length === 0) {
    return { success: false, error: 'invalid_code' };
  }

  const { user_id: userId, expires_at: expiresAt } = linkingCodeResult[0];

  if (new Date() > expiresAt) {
    await sql`
      DELETE FROM account_linking_codes
      WHERE code = ${code}
    `;

    return { success: false, error: 'expired' };
  }

  const existingLinkResult = await sql<{ id: number; username: string }[]>`
    SELECT id, username
    FROM users
    WHERE discord_id = ${discordId}
  `;

  if (existingLinkResult.length > 0) {
    const existingUser = existingLinkResult[0];
    if (existingUser.id !== userId) {
      return { success: false, error: 'conflict' };
    }
  }

  let user: LinkedUser;

  try {
    const [userResult] = await sql<
      {
        id: number;
        username: string;
        discord_id: string;
        discord_username: string;
      }[]
    >`
      UPDATE users
      SET discord_id = ${discordId},
          discord_username = ${discordUsername}
      WHERE id = ${userId}
      RETURNING id, username, discord_id, discord_username
    `;

    if (!userResult) {
      // This is unlikely to occur as it would require the user to be deleted
      // between reading the linking code from the database and updating the
      // user.
      return { success: false, error: 'user_not_found' };
    }

    user = {
      id: userResult.id,
      username: userResult.username,
      discordId: userResult.discord_id,
      discordUsername: userResult.discord_username,
    };
  } catch (e) {
    if (isPostgresUniqueViolation(e)) {
      return { success: false, error: 'conflict' };
    }
    console.error('Error verifying Discord link:', e);
    return { success: false, error: 'internal_error' };
  }

  await sql`
    DELETE FROM account_linking_codes
    WHERE code = ${code}
  `;

  return { success: true, user };
}

export type GrantApiAccessResult =
  | {
      success: true;
      user: { id: number; username: string; canCreateApiKey: boolean };
    }
  | {
      success: false;
      error: 'user_not_found' | 'limit_reached' | 'unavailable';
    };

const API_KEY_USER_LIMIT_KEY = 'blert:api_key_user_limit';

type LimitResult =
  | { success: true; limit: number }
  | { success: false; error: 'unavailable' };

async function getApiKeyUserLimit(): Promise<LimitResult> {
  let redisAvailable = false;

  try {
    const redisClient = await redis();
    const limitStr = await redisClient.get(API_KEY_USER_LIMIT_KEY);
    redisAvailable = true;
    if (limitStr !== null) {
      const limit = parseInt(limitStr, 10);
      if (!isNaN(limit)) {
        return { success: true, limit };
      }
    }
  } catch (e) {
    console.error('Failed to get API key user limit from Redis:', e);
  }

  // Fall back to env var if Redis key is not set.
  const envLimit = process.env.BLERT_API_KEY_USER_LIMIT;
  if (envLimit !== undefined) {
    const limit = parseInt(envLimit, 10);
    if (!isNaN(limit)) {
      return { success: true, limit };
    }
  }

  // If Redis was unavailable and no env var fallback, fail closed.
  if (!redisAvailable) {
    return { success: false, error: 'unavailable' };
  }

  // Redis is available but no limit is configured anywhere; no limit enforced.
  return { success: true, limit: Infinity };
}

/**
 * Grants API key creation access to a user by their Discord ID.
 *
 * @param discordId The Discord user ID
 * @returns Result object with user data on success or error on failure
 */
export async function grantApiAccess(
  discordId: string,
): Promise<GrantApiAccessResult> {
  // Check if the user already has access (idempotent operation).
  const existingUser = await sql<
    { id: number; username: string; can_create_api_key: boolean }[]
  >`
    SELECT id, username, can_create_api_key
    FROM users
    WHERE discord_id = ${discordId}
  `;

  if (existingUser.length === 0) {
    return { success: false, error: 'user_not_found' };
  }

  // If the user already has access, return success without checking limit.
  if (existingUser[0].can_create_api_key) {
    return {
      success: true,
      user: {
        id: existingUser[0].id,
        username: existingUser[0].username,
        canCreateApiKey: true,
      },
    };
  }

  // Check if the limit has been reached.
  const limitResult = await getApiKeyUserLimit();
  if (!limitResult.success) {
    return { success: false, error: limitResult.error };
  }

  const [{ count }] = await sql<{ count: string }[]>`
    SELECT COUNT(*) FROM users WHERE can_create_api_key = true
  `;
  if (parseInt(count, 10) >= limitResult.limit) {
    return { success: false, error: 'limit_reached' };
  }

  const result = await sql<
    { id: number; username: string; can_create_api_key: boolean }[]
  >`
    UPDATE users
    SET can_create_api_key = true
    WHERE discord_id = ${discordId}
    RETURNING id, username, can_create_api_key
  `;

  const user = result[0];

  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      canCreateApiKey: user.can_create_api_key,
    },
  };
}
