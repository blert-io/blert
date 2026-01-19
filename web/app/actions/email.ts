'use server';

import { isPostgresUniqueViolation } from '@blert/common';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';

import { auth } from '@/auth';
import {
  sendVerificationEmail as sendVerificationEmailTemplate,
  sendPasswordResetEmail as sendPasswordResetEmailTemplate,
  sendEmailChangeEmail as sendEmailChangeEmailTemplate,
} from '@/email/send';

import { sql } from './db';
import redis from './redis';

const TOKEN_BYTE_LENGTH = 32;
const SALT_ROUNDS = 10;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_EMAILS_PER_HOUR = 5;

type EmailTokenType = 'email_verification' | 'password_reset' | 'email_change';

const EXPIRY_MS_BY_TOKEN_TYPE: Record<EmailTokenType, number> = {
  email_verification: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
  email_change: 24 * 60 * 60 * 1000,
};

const emailSchema = z.string().email().max(128);

type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfter: number };

const HOUR_MS = 3_600_000;

async function checkRateLimit(
  userId: number,
  type: EmailTokenType,
): Promise<RateLimitResult> {
  const redisClient = await redis();
  const now = Date.now();
  const posixHour = Math.floor(now / HOUR_MS);
  const hourKey = `blert:email:ratelimit:${userId}:${type}:${posixHour}`;
  const lastSentKey = `blert:email:lastsent:${userId}:${type}`;

  const setOk = await redisClient.set(lastSentKey, now.toString(), {
    NX: true,
    PX: RATE_LIMIT_WINDOW_MS,
  });

  if (setOk === null) {
    const pttl = await redisClient.pTTL(lastSentKey);
    // PTTL can sometimes be negative so fall back to the window size.
    const retryAfter = Math.ceil(
      (pttl > 0 ? pttl : RATE_LIMIT_WINDOW_MS) / 1000,
    );
    return { allowed: false, retryAfter };
  }

  const nextHourMs = (posixHour + 1) * HOUR_MS;
  const secondsToNextHour = Math.max(1, Math.ceil((nextHourMs - now) / 1000));

  const multi = redisClient.multi();
  multi.incr(hourKey);
  multi.expire(hourKey, secondsToNextHour + 60); // +1m buffer
  const results = await multi.exec();
  const hourCount = results[0] as number;

  if (hourCount > MAX_EMAILS_PER_HOUR) {
    await redisClient.pExpire(lastSentKey, secondsToNextHour * 1000);
    return { allowed: false, retryAfter: secondsToNextHour };
  }

  return { allowed: true };
}

function generateToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function insertNewEmailToken(
  userId: number,
  type: EmailTokenType,
  email: string,
  setPendingEmail: boolean = false,
): Promise<string> {
  // Invalidate existing tokens.
  await sql`
    UPDATE email_tokens SET used_at = NOW()
    WHERE user_id = ${userId} AND type = ${type} AND used_at IS NULL
  `;

  const normalizedEmail = email.toLowerCase();

  while (true) {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + EXPIRY_MS_BY_TOKEN_TYPE[type]);

    try {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO email_tokens (user_id, type, token, email, expires_at)
          VALUES (${userId}, ${type}, ${tokenHash}, ${normalizedEmail}, ${expiresAt})
        `;
        if (setPendingEmail) {
          await tx`
            UPDATE users SET pending_email = ${normalizedEmail} WHERE id = ${userId}
          `;
        }
      });
    } catch (e: unknown) {
      if (isPostgresUniqueViolation(e)) {
        // Token already exists, try again.
        continue;
      }
      throw e;
    }

    return token;
  }
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

export type SendVerificationResult =
  | { success: true }
  | { success: false; error: 'rate_limited'; retryAfter: number }
  | {
      success: false;
      error: 'already_verified' | 'not_found' | 'send_failed' | 'invalid_email';
    };

export async function sendVerificationEmail(
  userId: number,
  email: string,
): Promise<SendVerificationResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return { success: false, error: 'invalid_email' };
  }

  const [user] = await sql<{ email_verified: boolean }[]>`
    SELECT email_verified FROM users WHERE id = ${userId}
  `;
  if (user === undefined) {
    return { success: false, error: 'not_found' };
  }
  if (user.email_verified) {
    return { success: false, error: 'already_verified' };
  }

  try {
    const rateLimit = await checkRateLimit(userId, 'email_verification');
    if (!rateLimit.allowed) {
      return {
        success: false,
        error: 'rate_limited',
        retryAfter: rateLimit.retryAfter,
      };
    }
  } catch (e) {
    console.error('Failed to check rate limit:', e);
    return {
      success: false,
      error: 'rate_limited',
      retryAfter: RATE_LIMIT_WINDOW_MS / 1000,
    };
  }

  const token = await insertNewEmailToken(userId, 'email_verification', email);
  try {
    await sendVerificationEmailTemplate(email, token);
    return { success: true };
  } catch (e) {
    console.error('Failed to send verification email:', e);
    return { success: false, error: 'send_failed' };
  }
}

export async function resendVerificationEmail(): Promise<SendVerificationResult> {
  const userId = await ensureAuthenticated();

  const [user] = await sql<{ email: string; email_verified: boolean }[]>`
    SELECT email, email_verified FROM users WHERE id = ${userId}
  `;
  if (user === undefined) {
    return { success: false, error: 'not_found' };
  }

  return sendVerificationEmail(userId, user.email);
}

export type VerifyEmailResult =
  | { success: true }
  | {
      success: false;
      error: 'invalid_token' | 'expired' | 'already_used' | 'already_verified';
    };

export async function verifyEmail(token: string): Promise<VerifyEmailResult> {
  const tokenHash = hashToken(token);
  const [tokenRecord] = await sql<
    {
      id: number;
      user_id: number;
      expires_at: Date;
      used_at: Date | null;
    }[]
  >`
    SELECT id, user_id, expires_at, used_at
    FROM email_tokens
    WHERE token = ${tokenHash} AND type = 'email_verification'
  `;

  if (tokenRecord === undefined) {
    return { success: false, error: 'invalid_token' };
  }

  if (tokenRecord.used_at !== null) {
    return { success: false, error: 'already_used' };
  }

  if (new Date() > tokenRecord.expires_at) {
    return { success: false, error: 'expired' };
  }

  const [user] = await sql<{ email_verified: boolean }[]>`
    SELECT email_verified FROM users WHERE id = ${tokenRecord.user_id}
  `;
  if (user?.email_verified) {
    return { success: false, error: 'already_verified' };
  }

  await sql.begin(async (tx) => {
    await tx`
      UPDATE email_tokens SET used_at = NOW() WHERE id = ${tokenRecord.id}
    `;
    await tx`
      UPDATE users SET email_verified = true WHERE id = ${tokenRecord.user_id}
    `;
  });

  return { success: true };
}

/**
 * Requests a password reset email for the given email address.
 *
 * @returns false if the email is invalid, true otherwise. Always returns true
 *          for valid emails to prevent enumeration attacks, even if the email
 *          doesn't exist, is rate limited, or the send fails.
 */
export async function requestPasswordReset(email: string): Promise<boolean> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return false;
  }

  const [user] = await sql<{ id: number; email: string }[]>`
    SELECT id, email
    FROM users
    WHERE lower(email) = ${email.toLowerCase()} AND email_verified = true
  `;
  if (user === undefined) {
    return true;
  }

  try {
    const rateLimit = await checkRateLimit(user.id, 'password_reset');
    if (!rateLimit.allowed) {
      return true;
    }
  } catch (e) {
    console.error('Failed to check rate limit:', e);
    return true;
  }

  const token = await insertNewEmailToken(
    user.id,
    'password_reset',
    user.email,
  );
  try {
    await sendPasswordResetEmailTemplate(user.email, token);
  } catch (e) {
    console.error('Failed to send password reset email:', e);
  }

  return true;
}

export type ValidateResetTokenResult =
  | { success: true }
  | { success: false; error: 'invalid_token' | 'expired' | 'already_used' };

export async function validateResetToken(
  token: string,
): Promise<ValidateResetTokenResult> {
  const tokenHash = hashToken(token);
  const [tokenRecord] = await sql<
    {
      expires_at: Date;
      used_at: Date | null;
    }[]
  >`
    SELECT expires_at, used_at
    FROM email_tokens
    WHERE token = ${tokenHash} AND type = 'password_reset'
  `;

  if (tokenRecord === undefined) {
    return { success: false, error: 'invalid_token' };
  }

  if (tokenRecord.used_at !== null) {
    return { success: false, error: 'already_used' };
  }

  if (new Date() > tokenRecord.expires_at) {
    return { success: false, error: 'expired' };
  }

  return { success: true };
}

export type ResetPasswordResult =
  | { success: true }
  | {
      success: false;
      error: 'invalid_token' | 'expired' | 'already_used' | 'invalid_password';
    };

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<ResetPasswordResult> {
  const tokenHash = hashToken(token);
  const [tokenRecord] = await sql<
    {
      id: number;
      user_id: number;
      expires_at: Date;
      used_at: Date | null;
    }[]
  >`
    SELECT id, user_id, expires_at, used_at
    FROM email_tokens
    WHERE token = ${tokenHash} AND type = 'password_reset'
  `;

  if (tokenRecord === undefined) {
    return { success: false, error: 'invalid_token' };
  }

  if (tokenRecord.used_at !== null) {
    return { success: false, error: 'already_used' };
  }

  if (new Date() > tokenRecord.expires_at) {
    return { success: false, error: 'expired' };
  }

  if (newPassword.length < 8 || newPassword.length > 96) {
    return { success: false, error: 'invalid_password' };
  }

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await sql.begin(async (tx) => {
    await tx`
      UPDATE email_tokens SET used_at = NOW() WHERE id = ${tokenRecord.id}
    `;
    await tx`
      UPDATE users SET password = ${hash} WHERE id = ${tokenRecord.user_id}
    `;
  });

  return { success: true };
}

export type RequestEmailChangeResult =
  | { success: true }
  | { success: false; error: 'rate_limited'; retryAfter: number }
  | {
      success: false;
      error: 'email_in_use' | 'same_email' | 'send_failed' | 'invalid_email';
    };

export async function requestEmailChange(
  newEmail: string,
): Promise<RequestEmailChangeResult> {
  const parsed = emailSchema.safeParse(newEmail);
  if (!parsed.success) {
    return { success: false, error: 'invalid_email' };
  }

  const userId = await ensureAuthenticated();

  const [user] = await sql<{ email: string }[]>`
    SELECT email FROM users WHERE id = ${userId}
  `;
  if (user === undefined) {
    throw new Error('User not found');
  }

  const normalizedNew = newEmail.toLowerCase();
  if (user.email.toLowerCase() === normalizedNew) {
    return { success: false, error: 'same_email' };
  }

  const [existing] = await sql<{ id: number }[]>`
    SELECT id FROM users WHERE lower(email) = ${normalizedNew}
  `;
  if (existing !== undefined) {
    return { success: false, error: 'email_in_use' };
  }

  try {
    const rateLimit = await checkRateLimit(userId, 'email_change');
    if (!rateLimit.allowed) {
      return {
        success: false,
        error: 'rate_limited',
        retryAfter: rateLimit.retryAfter,
      };
    }
  } catch (e) {
    console.error('Failed to check rate limit:', e);
    return {
      success: false,
      error: 'rate_limited',
      retryAfter: RATE_LIMIT_WINDOW_MS / 1000,
    };
  }

  const token = await insertNewEmailToken(
    userId,
    'email_change',
    normalizedNew,
    true,
  );

  try {
    await sendEmailChangeEmailTemplate(normalizedNew, token);
    return { success: true };
  } catch (e) {
    console.error('Failed to send email change email:', e);
    return { success: false, error: 'send_failed' };
  }
}

export type VerifyEmailChangeResult =
  | { success: true; newEmail: string }
  | {
      success: false;
      error: 'invalid_token' | 'expired' | 'already_used' | 'email_in_use';
    };

export async function verifyEmailChange(
  token: string,
): Promise<VerifyEmailChangeResult> {
  const tokenHash = hashToken(token);
  const [tokenRecord] = await sql<
    {
      id: number;
      user_id: number;
      email: string;
      expires_at: Date;
      used_at: Date | null;
    }[]
  >`
    SELECT id, user_id, email, expires_at, used_at
    FROM email_tokens
    WHERE token = ${tokenHash} AND type = 'email_change'
  `;

  if (tokenRecord === undefined) {
    return { success: false, error: 'invalid_token' };
  }

  if (tokenRecord.used_at !== null) {
    return { success: false, error: 'already_used' };
  }

  if (new Date() > tokenRecord.expires_at) {
    return { success: false, error: 'expired' };
  }

  try {
    await sql.begin(async (tx) => {
      await tx`
        UPDATE email_tokens SET used_at = NOW() WHERE id = ${tokenRecord.id}
      `;
      await tx`
        UPDATE users
        SET email = ${tokenRecord.email},
            pending_email = NULL,
            email_verified = true
        WHERE id = ${tokenRecord.user_id}
      `;
    });
  } catch (e: unknown) {
    if (isPostgresUniqueViolation(e)) {
      return { success: false, error: 'email_in_use' };
    }
    throw e;
  }

  return { success: true, newEmail: tokenRecord.email };
}

export async function cancelEmailChange(): Promise<void> {
  const userId = await ensureAuthenticated();

  await sql.begin(async (tx) => {
    await tx`
      UPDATE email_tokens SET used_at = NOW()
      WHERE user_id = ${userId} AND type = 'email_change' AND used_at IS NULL
    `;
    await tx`
      UPDATE users SET pending_email = NULL WHERE id = ${userId}
    `;
  });
}
