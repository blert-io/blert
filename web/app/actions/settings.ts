'use server';

import { JSONValue } from 'postgres';

import { sql } from './db';
import { AuthenticationError } from './errors';
import { getSignedInUserId } from './users';

export type UserSettings = Record<string, unknown>;

/**
 * Get all settings for the currently authenticated user.
 * @returns Record of setting keys to values, or null if not authenticated.
 */
export async function getUserSettings(): Promise<UserSettings | null> {
  const userId = await getSignedInUserId();
  if (userId === null) {
    return null;
  }

  const rows = await sql<{ key: string; value: unknown }[]>`
    SELECT key, value FROM user_settings
    WHERE user_id = ${userId}
  `;

  const settings: UserSettings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

/**
 * Update a single setting for the currently authenticated user.
 * @param key The setting key.
 * @param value The setting value.
 */
export async function setUserSetting(
  key: string,
  value: unknown,
): Promise<void> {
  const userId = await getSignedInUserId();
  if (userId === null) {
    throw new AuthenticationError();
  }

  const jsonValue = sql.json(value as JSONValue);
  await sql`
    INSERT INTO user_settings (user_id, key, value, updated_at)
    VALUES (${userId}, ${key}, ${jsonValue}, NOW())
    ON CONFLICT (user_id, key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

/**
 * Sync multiple settings from localStorage to the server.
 * Only syncs settings that don't already exist on the server.
 *
 * @param settings The settings to sync.
 * @returns The final merged settings from the server.
 */
export async function syncSettings(
  settings: UserSettings,
): Promise<UserSettings> {
  const userId = await getSignedInUserId();
  if (userId === null) {
    throw new AuthenticationError();
  }

  const entries = Object.entries(settings);

  if (entries.length > 0) {
    const insertRows = entries.map(([key, value]) => ({
      user_id: userId,
      key,
      value: sql.json(value as JSONValue),
    }));

    // Batch insert all settings, skipping any that already exist.
    await sql`
      INSERT INTO user_settings ${sql(insertRows)}
      ON CONFLICT (user_id, key) DO NOTHING
    `;
  }

  // Re-fetch all settings to get the authoritative merged state.
  const rows = await sql<{ key: string; value: unknown }[]>`
    SELECT key, value FROM user_settings
    WHERE user_id = ${userId}
  `;

  const merged: UserSettings = {};
  for (const row of rows) {
    merged[row.key] = row.value;
  }
  return merged;
}
