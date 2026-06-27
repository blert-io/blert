import { timingSafeEqual } from 'crypto';

import logger from '@/utils/log';

/** Extracts the token from a `Bearer <token>` authorization header. */
function bearerToken(authHeader: string | null): string | null {
  if (authHeader === null) {
    return null;
  }
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }
  return parts[1];
}

function secretsMatch(provided: string, expected: string): boolean {
  try {
    const expectedBuffer = Buffer.from(expected, 'utf-8');
    const providedBuffer = Buffer.from(provided, 'utf-8');

    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }

    return timingSafeEqual(providedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Validates the admin API secret from the authorization header.
 */
export function validateAdminAuth(authHeader: string | null): boolean {
  const token = bearerToken(authHeader);
  if (token === null) {
    return false;
  }

  const secret = process.env.BLERT_ADMIN_SECRET;
  if (!secret) {
    logger.error('admin_secret_not_configured');
    return false;
  }

  return secretsMatch(token, secret);
}

/**
 * Validates the Discord bot secret from the authorization header. The admin
 * secret is also accepted, as it is valid for all admin endpoints.
 */
export function validateDiscordBotAuth(authHeader: string | null): boolean {
  const token = bearerToken(authHeader);
  if (token === null) {
    return false;
  }

  const botSecret = process.env.BLERT_DISCORD_BOT_SECRET;
  if (!botSecret) {
    logger.error('discord_bot_secret_not_configured');
    return false;
  }

  if (secretsMatch(token, botSecret)) {
    return true;
  }

  const adminSecret = process.env.BLERT_ADMIN_SECRET;
  return adminSecret !== undefined && secretsMatch(token, adminSecret);
}
