import logger from '../log';
import { DeliveryOutcome } from '../runner';

/**
 * Discord embed structure for webhook messages.
 * @see https://discord.com/developers/docs/resources/message#embed-object
 */
export type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  footer?: {
    text: string;
    icon_url?: string;
  };
  thumbnail?: {
    url: string;
  };
  image?: {
    url: string;
  };
  author?: {
    name: string;
    url?: string;
    icon_url?: string;
  };
  fields?: {
    name: string;
    value: string;
    inline?: boolean;
  }[];
};

/** Discord webhook payload structure. */
export type DiscordWebhookPayload = {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
};

/** Posts messages to a configured Discord webhook. */
export class DiscordWebhook {
  private readonly url: string;
  private readonly maskedUrl: string;

  public constructor(url: string) {
    this.url = url;
    this.maskedUrl = maskUrl(url);
  }

  /**
   * Posts a message to the webhook.
   *
   * @param payload The message to post.
   * @returns One of:
   *   -`delivered` on success
   *   - `retry` on a server error, or on a rate limit, with `after` set from
   *      the `Retry-After` header
   *   -`failed` on any other client error.
   * @throws If sending the request fails in an unexpected way.
   */
  public async post(payload: DiscordWebhookPayload): Promise<DeliveryOutcome> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return { status: 'delivered' };
    }

    logger.warn('discord_webhook_rejected', {
      webhookUrl: this.maskedUrl,
      status: response.status,
      statusText: response.statusText,
    });

    const reason = `HTTP ${response.status}`;
    if (response.status === 429) {
      return { status: 'retry', after: retryAfterMs(response), reason };
    }
    if (response.status >= 400 && response.status < 500) {
      return { status: 'failed', reason };
    }
    return { status: 'retry', reason };
  }
}

/**
 * Extracts a response's `Retry-After` header, which Discord sends in seconds.
 * @returns The retry delay in milliseconds, or undefined if the header is
 *   absent or unparseable.
 */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('Retry-After');
  if (header === null || header === '') {
    return undefined;
  }
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return Math.ceil(seconds * 1000);
}

/** Hides the token of a webhook URL for logging. */
export function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Discord webhook URLs have the form /api/webhooks/{id}/{token}, possibly
    // with a trailing separator.
    const parts = parsed.pathname.split('/').filter((part) => part !== '');
    if (parts.length >= 3) {
      parts[parts.length - 1] = '***';
      parsed.pathname = `/${parts.join('/')}`;
    }
    return parsed.toString();
  } catch {
    return '***';
  }
}
