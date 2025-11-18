import { timingSafeEqual } from 'crypto';

/**
 * Validates the Discord bot secret from the Authorization header.
 *
 * @param authHeader The Authorization header value (e.g., "Bearer <secret>")
 * @returns True if the secret is valid, false otherwise
 */
export function validateDiscordBotAuth(authHeader: string | null): boolean {
  if (authHeader === null) {
    return false;
  }

  const secret = process.env.BLERT_DISCORD_BOT_SECRET;
  if (!secret) {
    console.error('BLERT_DISCORD_BOT_SECRET is not configured');
    return false;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return false;
  }

  const providedSecret = parts[1];
  try {
    const secretBuffer = Buffer.from(secret, 'utf-8');
    const providedBuffer = Buffer.from(providedSecret, 'utf-8');

    // Buffers must be the same length for timingSafeEqual.
    if (secretBuffer.length !== providedBuffer.length) {
      return false;
    }

    return timingSafeEqual(secretBuffer, providedBuffer);
  } catch {
    return false;
  }
}
