'use server';

import { randomBytes, randomInt } from 'crypto';
import {
  ApiKey,
  Skill,
  User,
  hiscoreLookup,
  isPostgresUniqueViolation,
} from '@blert/common';
import { headers } from 'next/headers';

import { auth } from '@/auth';
import { sql } from './db';
import { AuthenticationError } from './errors';

/**
 * Checks if a user with the specified username exists in the database.
 * @param username The username to check.
 * @returns Promise resolving to true if the user exists, false otherwise.
 */
export async function userExists(username: string): Promise<boolean> {
  const result = await sql`
    SELECT 1 FROM users
    WHERE lower(username) = ${username.toLowerCase()}
    LIMIT 1
  `;
  return result.length > 0;
}

export async function getSignedInUserId(): Promise<number | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user.id) {
    return null;
  }
  return parseInt(session.user.id, 10);
}

export async function getSignedInUser(): Promise<User | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user.id) {
    return null;
  }

  const [user] = await sql<
    {
      id: number;
      username: string;
      display_username: string | null;
      email: string;
      created_at: Date;
      email_verified: boolean;
      can_create_api_key: boolean;
      discord_id: string | null;
      discord_username: string | null;
    }[]
  >`SELECT
      id,
      username,
      display_username,
      email,
      created_at,
      email_verified,
      can_create_api_key,
      discord_id,
      discord_username
    FROM users
    WHERE id = ${session.user.id}
  `;
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    displayUsername: user.display_username,
    email: user.email,
    createdAt: user.created_at,
    emailVerified: user.email_verified,
    canCreateApiKey: user.can_create_api_key,
    discordId: user.discord_id,
    discordUsername: user.discord_username,
  };
}

async function ensureAuthenticated(): Promise<number> {
  const userId = await getSignedInUserId();
  if (userId === null) {
    throw new AuthenticationError();
  }
  return userId;
}

export type ApiKeyWithUsername = ApiKey & { rsn: string };

export type UserSettings = {
  apiKeys: ApiKeyWithUsername[];
};

/**
 * Returns all settings for the current user.
 * @returns The user's settings.
 */
export async function getUserSettings(): Promise<UserSettings> {
  const userId = await ensureAuthenticated();
  const apiKeys = await getApiKeys(userId);
  return { apiKeys };
}

async function getApiKeys(userId: number): Promise<ApiKeyWithUsername[]> {
  const keysWithPlayer = await sql<
    {
      id: number;
      key: string;
      active: boolean;
      last_used: Date | null;
      rsn: string;
    }[]
  >`
    SELECT
      api_keys.id,
      api_keys.key,
      api_keys.active,
      api_keys.last_used,
      players.username as rsn
    FROM api_keys
    JOIN players ON api_keys.player_id = players.id
    WHERE api_keys.user_id = ${userId}
  `;

  return keysWithPlayer.map((key) => ({
    id: key.id,
    key: key.key,
    active: key.active,
    lastUsed: key.last_used,
    rsn: key.rsn,
  }));
}

const API_KEY_HEX_LENGTH = 24;
const API_KEY_BYTE_LENGTH = API_KEY_HEX_LENGTH / 2;

const MAX_API_KEYS_PER_USER = 3;

export async function createApiKey(rsn: string): Promise<ApiKeyWithUsername> {
  const userId = await ensureAuthenticated();

  if (rsn.length < 1 || rsn.length > 12) {
    throw new Error('Invalid RSN');
  }

  const canCreate = await sql`
    SELECT can_create_api_key FROM users WHERE id = ${userId}
  `;
  if (canCreate.length === 0 || !canCreate[0].can_create_api_key) {
    throw new Error('Not authorized to create API keys');
  }

  const [apiKeyCount] = await sql<{ count: string }[]>`
    SELECT COUNT(*) FROM api_keys WHERE user_id = ${userId}
  `;
  if (parseInt(apiKeyCount.count) >= MAX_API_KEYS_PER_USER) {
    throw new Error('Maximum number of API keys reached');
  }

  let [player] = await sql<{ id: number; username: string }[]>`
    SELECT id, username
    FROM players
    WHERE lower(username) = ${rsn.toLowerCase()}
  `;

  if (!player) {
    let experience;
    try {
      experience = await hiscoreLookup(rsn);
    } catch {
      throw new Error(
        'Unable to create API key at this time, please try again later',
      );
    }
    if (experience === null) {
      throw new Error('Player does not exist on Hiscores');
    }

    const [{ id }] = await sql<{ id: number }[]>`
      INSERT INTO players (
        username,
        overall_experience,
        attack_experience,
        defence_experience,
        strength_experience,
        hitpoints_experience,
        ranged_experience,
        prayer_experience,
        magic_experience,
        last_updated
      ) VALUES (
        ${rsn},
        ${experience[Skill.OVERALL]},
        ${experience[Skill.ATTACK]},
        ${experience[Skill.DEFENCE]},
        ${experience[Skill.STRENGTH]},
        ${experience[Skill.HITPOINTS]},
        ${experience[Skill.RANGED]},
        ${experience[Skill.PRAYER]},
        ${experience[Skill.MAGIC]},
        NOW()
      ) RETURNING id
    `;
    player = { id, username: rsn };
  } else {
    const [existingKey] = await sql<{ id: number }[]>`
      SELECT id
      FROM api_keys
      WHERE user_id = ${userId} AND player_id = ${player.id}
    `;
    if (existingKey) {
      throw new Error('You already have an API key for this player');
    }
  }

  let apiKey: ApiKey;
  while (true) {
    const key = randomBytes(API_KEY_BYTE_LENGTH).toString('hex');

    try {
      const [{ id: keyId }] = await sql<{ id: number }[]>`
        INSERT INTO api_keys (user_id, player_id, key)
        VALUES (${userId}, ${player.id}, ${key})
        RETURNING id
      `;
      apiKey = {
        id: keyId,
        key,
        lastUsed: null,
        active: true,
      };
      break;
    } catch (e: any) {
      if (isPostgresUniqueViolation(e)) {
        // Try again if the key already exists.
        continue;
      }
      console.error(e);
      throw new Error('Failed to create API key');
    }
  }

  return { ...apiKey, rsn: player.username };
}

export async function deleteApiKey(key: string): Promise<void> {
  const userId = await ensureAuthenticated();

  await sql`
    DELETE FROM api_keys
    WHERE key = ${key} AND user_id = ${userId}
  `;
}

export type ApiKeyFormState = {
  apiKey?: ApiKeyWithUsername;
  error?: string;
};

export async function submitApiKeyForm(
  _state: ApiKeyFormState,
  formData: FormData,
): Promise<ApiKeyFormState> {
  const rsn = (formData.get('blert-api-key-rsn') as string).trim();
  if (rsn.length < 1 || rsn.length > 12) {
    return { error: 'Invalid RSN' };
  }

  let apiKey;
  try {
    apiKey = await createApiKey(rsn);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  }

  return { apiKey };
}

const LINKING_CODE_LENGTH = 8;
const LINKING_CODE_CHARS = '23456789BCDFGHJKMNPQRSTVWXYZ';
const LINKING_CODE_EXPIRY_MS = 15 * 60 * 1000;

export type LinkingCode = {
  code: string;
  expiresAt: Date;
};

export type ConnectedPlayer = {
  id: number;
  username: string;
};

/**
 * Gets the list of OSRS players connected to the current user's account.
 *
 * @returns List of players connected to the current user's account.
 */
export async function getConnectedPlayers(): Promise<ConnectedPlayer[]> {
  const userId = await ensureAuthenticated();
  const players = await sql<{ id: number; username: string }[]>`
    SELECT p.id, p.username
    FROM users u
    JOIN api_keys a ON u.id = a.user_id
    JOIN players p ON a.player_id = p.id
    WHERE u.id = ${userId}
  `;
  return players.map((p) => ({ id: p.id, username: p.username }));
}

/**
 * Generates a new Discord linking code for the current user.
 * If a non-expired code already exists, returns that instead.
 * @returns The linking code and its expiration time.
 */
export async function generateDiscordLinkingCode(): Promise<LinkingCode> {
  const userId = await ensureAuthenticated();

  const expiresAt = new Date(Date.now() + LINKING_CODE_EXPIRY_MS);

  const MAX_RETRIES = 20;

  for (let i = 0; i < MAX_RETRIES; i++) {
    const code = Array.from(
      { length: LINKING_CODE_LENGTH },
      () => LINKING_CODE_CHARS[randomInt(0, LINKING_CODE_CHARS.length)],
    ).join('');

    try {
      const [result] = await sql<{ code: string; expires_at: Date }[]>`
        INSERT INTO account_linking_codes (user_id, type, code, expires_at)
        VALUES (${userId}, 'discord', ${code}, ${expiresAt})
        ON CONFLICT (user_id, type)
        DO UPDATE SET
          code = CASE
            WHEN account_linking_codes.expires_at < NOW() THEN EXCLUDED.code
            ELSE account_linking_codes.code
          END,
          expires_at = CASE
            WHEN account_linking_codes.expires_at < NOW() THEN EXCLUDED.expires_at
            ELSE account_linking_codes.expires_at
          END
        RETURNING code, expires_at
      `;

      return {
        code: result.code,
        expiresAt: result.expires_at,
      };
    } catch (e: unknown) {
      if (isPostgresUniqueViolation(e)) {
        continue;
      }
      console.error(e);
      throw new Error('Failed to generate linking code');
    }
  }

  throw new Error(
    `Failed to generate linking code after ${MAX_RETRIES} retries`,
  );
}

/**
 * Gets the active Discord linking code for the current user, if one exists.
 * @returns The linking code and expiration, or null if none exists.
 */
export async function getActiveLinkingCode(): Promise<LinkingCode | null> {
  const userId = await ensureAuthenticated();

  const result = await sql<{ code: string; expires_at: Date }[]>`
    SELECT code, expires_at
    FROM account_linking_codes
    WHERE user_id = ${userId}
      AND type = 'discord'
      AND expires_at > NOW()
  `;

  if (result.length === 0) {
    return null;
  }

  return {
    code: result[0].code,
    expiresAt: result[0].expires_at,
  };
}

export type DiscordLinkStatus = {
  isLinked: boolean;
  discordId: string | null;
  discordUsername: string | null;
};

/**
 * Gets the Discord link status for the current user.
 * @returns The Discord link status.
 */
export async function getDiscordLinkStatus(): Promise<DiscordLinkStatus> {
  const userId = await ensureAuthenticated();

  const [user] = await sql<
    { discord_id: string | null; discord_username: string | null }[]
  >`
    SELECT discord_id, discord_username
    FROM users
    WHERE id = ${userId}
  `;

  if (!user) {
    throw new Error('User not found');
  }

  return {
    isLinked: user.discord_id !== null,
    discordId: user.discord_id,
    discordUsername: user.discord_username,
  };
}

/**
 * Unlinks the Discord account from the current user.
 */
export async function unlinkDiscord(): Promise<void> {
  const userId = await ensureAuthenticated();
  await Promise.all([
    sql`
      UPDATE users
      SET discord_id = NULL, discord_username = NULL
      WHERE id = ${userId}
    `,
    sql`
      DELETE FROM account_linking_codes
      WHERE user_id = ${userId}
        AND type = 'discord'
    `,
  ]);
}
