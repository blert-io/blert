'use server';

import { randomBytes, randomInt } from 'crypto';
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
import { validateRedirectUrl } from '@/utils/url';
import { sql } from './db';
import { sendVerificationEmail } from './email';

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

export type VerifiedUser = {
  id: string;
  emailVerified: boolean;
};

export async function getEmailVerificationStatus(
  userId: string,
): Promise<boolean> {
  const [user] = await sql<{ email_verified: boolean }[]>`
    SELECT email_verified FROM users WHERE id = ${userId}
  `;
  return user?.email_verified ?? false;
}

export async function verifyUser(
  username: string,
  password: string,
): Promise<VerifiedUser> {
  const user = await sql<
    { id: number; password: string; email_verified: boolean }[]
  >`
    SELECT id, password, email_verified FROM users
    WHERE lower(username) = ${username.toLowerCase()}
    LIMIT 1
  `;

  if (user.length > 0) {
    const validPassword = await bcrypt.compare(password, user[0].password);
    if (validPassword) {
      return {
        id: user[0].id.toString(),
        emailVerified: user[0].email_verified,
      };
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

  let userId: number;
  try {
    const [newUser] = await sql<{ id: number }[]>`
      INSERT INTO users (username, password, email)
      VALUES (${username}, ${hash}, ${email.toLowerCase()})
      RETURNING id
    `;
    userId = newUser.id;
  } catch (e: unknown) {
    if (isPostgresUniqueViolation(e)) {
      return { email: ['Email address is already in use'] };
    }
    return { overall: 'An error occurred while creating your account' };
  }

  // Send verification email (fire-and-forget).
  void sendVerificationEmail(userId, email.toLowerCase()).catch((e) => {
    console.error('Failed to send verification email on registration:', e);
  });

  const redirectTo = validateRedirectUrl(
    formData.get('redirectTo') as string | undefined,
  );
  await signIn('credentials', { username, password, redirectTo });
  return null;
}

export async function getSignedInUser(): Promise<User | null> {
  const session = await auth();
  if (!session?.user.id) {
    return null;
  }

  const [user] = await sql<
    {
      id: number;
      username: string;
      email: string;
      created_at: Date;
      email_verified: boolean;
      pending_email: string | null;
      can_create_api_key: boolean;
      discord_id: string | null;
      discord_username: string | null;
    }[]
  >`SELECT
      id,
      username,
      email,
      created_at,
      email_verified,
      pending_email,
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
    email: user.email,
    createdAt: user.created_at,
    emailVerified: user.email_verified,
    pendingEmail: user.pending_email,
    canCreateApiKey: user.can_create_api_key,
    discordId: user.discord_id,
    discordUsername: user.discord_username,
  };
}

async function ensureAuthenticated(): Promise<number> {
  const session = await auth();
  if (!session?.user.id) {
    throw new Error('Not authenticated');
  }
  const userId = Number.parseInt(session.user.id, 10);
  if (!Number.isInteger(userId)) {
    throw new Error('Invalid user ID');
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

const MAX_API_KEYS_PER_USER = 1;

export async function createApiKey(rsn: string): Promise<ApiKeyWithUsername> {
  const userId = await ensureAuthenticated();

  if (rsn.length < 1 || rsn.length > 12) {
    throw new Error('Invalid RSN');
  }

  // TODO(frolv): This is temporary.
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

const passwordResetSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, { message: 'Current password is required' }),
    newPassword: z
      .string()
      .min(8, { message: 'Password must be at least 8 characters' })
      .max(96, { message: 'Password must be at most 96 characters' })
      .trim(),
    confirmPassword: z
      .string()
      .min(1, { message: 'Password confirmation is required' }),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type PasswordResetErrors = {
  currentPassword?: string[];
  newPassword?: string[];
  confirmPassword?: string[];
  overall?: string;
};

export async function changePassword(
  _state: PasswordResetErrors | null,
  formData: FormData,
): Promise<PasswordResetErrors | null> {
  const userId = await ensureAuthenticated();

  const validatedFields = passwordResetSchema.safeParse({
    currentPassword: formData.get('current-password'),
    newPassword: formData.get('new-password'),
    confirmPassword: formData.get('confirm-password'),
  });

  if (!validatedFields.success) {
    return validatedFields.error.flatten().fieldErrors;
  }

  const { currentPassword, newPassword } = validatedFields.data;

  const [user] = await sql<{ password: string }[]>`
    SELECT password FROM users
    WHERE id = ${userId}
  `;

  if (!user) {
    return { overall: 'User not found' };
  }

  const validCurrentPassword = await bcrypt.compare(
    currentPassword,
    user.password,
  );
  if (!validCurrentPassword) {
    return { currentPassword: ['Current password is incorrect'] };
  }

  const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  try {
    await sql`
      UPDATE users
      SET password = ${newPasswordHash}
      WHERE id = ${userId}
    `;
  } catch (e: any) {
    console.error('Error updating password:', e);
    return { overall: 'An error occurred while updating your password' };
  }

  return null;
}

const LINKING_CODE_LENGTH = 8;
const LINKING_CODE_CHARS = '23456789BCDFGHJKMNPQRSTVWXYZ';
const LINKING_CODE_EXPIRY_MS = 15 * 60 * 1000;

export type LinkingCode = {
  code: string;
  expiresAt: Date;
};

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
