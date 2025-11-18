import { validateDiscordBotAuth } from '@/api/admin/auth';

describe('validateDiscordBotAuth', () => {
  const originalEnv = process.env.BLERT_DISCORD_BOT_SECRET;

  beforeEach(() => {
    process.env.BLERT_DISCORD_BOT_SECRET = 'test-secret-key';
  });

  afterEach(() => {
    process.env.BLERT_DISCORD_BOT_SECRET = originalEnv;
  });

  it('should return true for valid Bearer token', () => {
    const authHeader = 'Bearer test-secret-key';
    expect(validateDiscordBotAuth(authHeader)).toBe(true);
  });

  it('should return false for null header', () => {
    expect(validateDiscordBotAuth(null)).toBe(false);
  });

  it('should return false for invalid secret', () => {
    const authHeader = 'Bearer wrong-secret';
    expect(validateDiscordBotAuth(authHeader)).toBe(false);
  });

  it('should return false for malformed header without Bearer prefix', () => {
    const authHeader = 'test-secret-key';
    expect(validateDiscordBotAuth(authHeader)).toBe(false);
  });

  it('should return false for malformed header with wrong prefix', () => {
    const authHeader = 'Basic test-secret-key';
    expect(validateDiscordBotAuth(authHeader)).toBe(false);
  });

  it('should return false for empty Bearer token', () => {
    const authHeader = 'Bearer ';
    expect(validateDiscordBotAuth(authHeader)).toBe(false);
  });

  it('should return false for header with extra spaces', () => {
    const authHeader = 'Bearer  test-secret-key';
    expect(validateDiscordBotAuth(authHeader)).toBe(false);
  });

  it('should return false for header with multiple parts', () => {
    const authHeader = 'Bearer test-secret-key extra-part';
    expect(validateDiscordBotAuth(authHeader)).toBe(false);
  });

  it('should return false when BLERT_DISCORD_BOT_SECRET is not configured', () => {
    delete process.env.BLERT_DISCORD_BOT_SECRET;
    const authHeader = 'Bearer test-secret-key';
    expect(validateDiscordBotAuth(authHeader)).toBe(false);
  });

  it('should return false for secrets of different lengths (timing attack protection)', () => {
    const authHeader = 'Bearer short';
    expect(validateDiscordBotAuth(authHeader)).toBe(false);
  });

  it('should be case-sensitive for the secret', () => {
    const authHeader = 'Bearer TEST-SECRET-KEY';
    expect(validateDiscordBotAuth(authHeader)).toBe(false);
  });

  it('should be case-sensitive for the Bearer prefix', () => {
    const authHeader = 'bearer test-secret-key';
    expect(validateDiscordBotAuth(authHeader)).toBe(false);
  });
});
