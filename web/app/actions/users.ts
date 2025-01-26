'use server';

import { randomBytes } from 'crypto';
import {
  ApiKey,
  Skill,
  User,
  hiscoreLookup,
  isPostgresUniqueViolation,
} from '@blert/common';
import bcrypt from 'bcrypt';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { z } from 'zod';

import { auth, signIn } from '@/auth';
import { sql } from './db';

const SALT_ROUNDS = 10;

const formSchema = z.object({
  username: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{2,24}$/, {
      message: 'Only letters, numbers, hyphens, or underscores',
    })
    .trim(),
  email: z.string().email({ message: 'Invalid email address' }),
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters' })
    .max(96, { message: 'Password must be at most 96 characters' })
    .trim(),
});

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

export async function verifyUser(
  username: string,
  password: string,
): Promise<string> {
  const user = await sql`
    SELECT id, password FROM users
    WHERE lower(username) = ${username.toLowerCase()}
    LIMIT 1
  `;

  if (user.length > 0) {
    const validPassword = await bcrypt.compare(password, user[0].password);
    if (validPassword) {
      return user[0].id.toString();
    }
  }

  throw new Error('Invalid username or password');
}

export async function login(
  _state: string | null,
  formData: FormData,
): Promise<string | null> {
  try {
    await signIn('credentials', {
      username: formData.get('blert-username'),
      password: formData.get('blert-password'),
      redirect: false,
    });
  } catch (e) {
    if (isRedirectError(e)) {
      throw e;
    }
    return 'Invalid username or password';
  }

  return null;
}

export type RegistrationErrors = {
  username?: string[];
  email?: string[];
  password?: string[];
  overall?: string;
};

export async function register(
  _state: RegistrationErrors | null,
  formData: FormData,
): Promise<RegistrationErrors | null> {
  const validatedFields = formSchema.safeParse({
    username: formData.get('blert-username'),
    email: formData.get('blert-email'),
    password: formData.get('blert-password'),
  });

  if (!validatedFields.success) {
    return validatedFields.error.flatten().fieldErrors;
  }

  const { username, password, email } = validatedFields.data;

  if (await userExists(username)) {
    return { username: [`Username ${username} is already taken`] };
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  if (!process.env.FEATURE_ACCOUNTS) {
    return { overall: 'Account creation is currently disabled' };
  }

  try {
    await sql`
    INSERT INTO users (username, password, email)
    VALUES (${username}, ${hash}, ${email.toLowerCase()})
    RETURNING id
  `;
  } catch (e: any) {
    if (isPostgresUniqueViolation(e)) {
      return { email: ['Email address is already in use'] };
    }
    return { overall: 'An error occurred while creating your account' };
  }

  await signIn('credentials', { username, password, redirectTo: '/' });
  return null;
}

export async function getSignedInUser(): Promise<User | null> {
  const session = await auth();
  if (session === null || session.user.id === undefined) {
    return null;
  }

  const [user] = await sql`SELECT * from users WHERE id = ${session.user.id}`;
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.created_at,
    emailVerified: user.email_verified,
    canCreateApiKey: user.can_create_api_key,
  };
}

export type ApiKeyWithUsername = ApiKey & { rsn: string };

export async function getApiKeys(): Promise<ApiKeyWithUsername[]> {
  const session = await auth();
  if (session === null || session.user.id === undefined) {
    throw new Error('Not authenticated');
  }

  const keysWithPlayer = await sql`
    SELECT
      api_keys.id,
      api_keys.key,
      api_keys.active,
      api_keys.last_used,
      players.username as rsn
    FROM api_keys
    JOIN players ON api_keys.player_id = players.id
    WHERE api_keys.user_id = ${session.user.id}
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

const MAX_API_KEYS_PER_USER = 1;

export async function createApiKey(rsn: string): Promise<ApiKeyWithUsername> {
  const session = await auth();
  if (session === null || session.user.id === undefined) {
    throw new Error('Not authenticated');
  }

  if (rsn.length < 1 || rsn.length > 12) {
    throw new Error('Invalid RSN');
  }

  // TODO(frolv): This is temporary.
  const canCreate = await sql`
    SELECT can_create_api_key FROM users WHERE id = ${session.user.id}
  `;
  if (canCreate.length === 0 || !canCreate[0].can_create_api_key) {
    throw new Error('Not authorized to create API keys');
  }

  const [apiKeyCount] = await sql`
    SELECT COUNT(*) FROM api_keys WHERE user_id = ${session.user.id}
  `;
  if (parseInt(apiKeyCount.count) >= MAX_API_KEYS_PER_USER) {
    throw new Error('Maximum number of API keys reached');
  }

  let [player] = await sql`
    SELECT id, username
    FROM players
    WHERE lower(username) = ${rsn.toLowerCase()}
  `;

  if (!player) {
    let experience;
    try {
      experience = await hiscoreLookup(rsn);
    } catch (e: any) {
      throw new Error(
        'Unable to create API key at this time, please try again later',
      );
    }
    if (experience === null) {
      throw new Error('Player does not exist on Hiscores');
    }

    const [{ id }] = await sql`
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
  }

  let apiKey: ApiKey;
  while (true) {
    const key = randomBytes(API_KEY_BYTE_LENGTH).toString('hex');

    try {
      let [{ keyId }] = await sql`
        INSERT INTO api_keys (user_id, player_id, key)
        VALUES (${session.user.id}, ${player.id}, ${key})
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
  const session = await auth();
  if (session === null || session.user.id === undefined) {
    throw new Error('Not authenticated');
  }

  await sql`
    DELETE FROM api_keys
    WHERE key = ${key} AND user_id = ${session.user.id}
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

  let apiKey;
  try {
    apiKey = await createApiKey(rsn);
  } catch (e: any) {
    return { error: e.message };
  }

  return { apiKey };
}
