import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { DiscordWebhook, DiscordWebhookPayload, maskUrl } from '../discord';

const WEBHOOK_URL = 'https://discord.com/api/webhooks/123456/some-token';

const PAYLOAD: DiscordWebhookPayload = {
  embeds: [{ title: 'New Record: Theatre of Blood (Regular) Maiden' }],
};

describe('maskUrl', () => {
  it.each([
    ['https://discord.com/api/webhooks/123456/some-token', ''],
    ['https://discord.com/api/webhooks/123456/some-token', '/'],
  ])('hides the token of %s%s', (url, suffix) => {
    expect(maskUrl(`${url}${suffix}`)).toBe(
      'https://discord.com/api/webhooks/123456/***',
    );
  });

  it('hides the whole URL when it cannot be parsed', () => {
    expect(maskUrl('not a url')).toBe('***');
  });
});

describe('DiscordWebhook', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function respondWith(status: number, headers?: Record<string, string>) {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status, headers }));
  }

  it('posts the payload as JSON to the webhook URL', async () => {
    respondWith(204);

    await new DiscordWebhook(WEBHOOK_URL).post(PAYLOAD);

    expect(fetchSpy.mock.calls).toEqual([
      [
        WEBHOOK_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(PAYLOAD),
        },
      ],
    ]);
  });

  it('reports a successful response as delivered', async () => {
    respondWith(204);

    await expect(
      new DiscordWebhook(WEBHOOK_URL).post(PAYLOAD),
    ).resolves.toEqual({ status: 'delivered' });
  });

  it('requests a retry on 429 after the Retry-After delay', async () => {
    respondWith(429, { 'Retry-After': '2.5' });

    await expect(
      new DiscordWebhook(WEBHOOK_URL).post(PAYLOAD),
    ).resolves.toEqual({ status: 'retry', after: 2500, reason: 'HTTP 429' });
  });

  it.each([
    ['absent', undefined],
    ['unparseable', 'soon'],
  ])(
    'requests a retry on 429 without after when Retry-After is %s',
    async (_, retryAfter) => {
      respondWith(
        429,
        retryAfter === undefined ? undefined : { 'Retry-After': retryAfter },
      );

      const outcome = await new DiscordWebhook(WEBHOOK_URL).post(PAYLOAD);

      expect(outcome).toEqual({ status: 'retry', reason: 'HTTP 429' });
      expect(outcome).not.toHaveProperty('after', expect.anything());
    },
  );

  it.each([400, 404])('fails on a %i client error', async (status) => {
    respondWith(status);

    await expect(
      new DiscordWebhook(WEBHOOK_URL).post(PAYLOAD),
    ).resolves.toEqual({ status: 'failed', reason: `HTTP ${status}` });
  });

  it.each([500, 503])(
    'requests a retry on a %i server error',
    async (status) => {
      respondWith(status);

      await expect(
        new DiscordWebhook(WEBHOOK_URL).post(PAYLOAD),
      ).resolves.toEqual({ status: 'retry', reason: `HTTP ${status}` });
    },
  );

  it('propagates a failed request', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(new DiscordWebhook(WEBHOOK_URL).post(PAYLOAD)).rejects.toThrow(
      'ECONNRESET',
    );
  });
});
