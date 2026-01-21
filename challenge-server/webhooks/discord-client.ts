import logger from '../log';

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

/**
 * Discord webhook payload structure.
 */
export type DiscordWebhookPayload = {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
};

type QueuedMessage = {
  payload: DiscordWebhookPayload;
  resolve: () => void;
  reject: (error: Error) => void;
  retryCount: number;
  context?: Record<string, unknown>;
};

type UrlQueue = {
  messages: QueuedMessage[];
  processing: boolean;
  backoffUntil: number;
};

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

const enum DeliveryResult {
  SUCCESS,
  RETRY,
  PERMANENT_FAILURE,
}

/**
 * A queuing dispatcher for Discord webhook delivery with exponential backoff.
 */
export class DiscordClient {
  private readonly queues = new Map<string, UrlQueue>();

  /**
   * Enqueues a message for delivery to a Discord webhook.
   *
   * @param webhookUrl The Discord webhook URL.
   * @param payload The webhook payload to send.
   * @param context Optional context for logging.
   * @returns A Promise that resolves when the message is delivered, or rejects
   *   after max retries are exhausted.
   */
  public enqueue(
    webhookUrl: string,
    payload: DiscordWebhookPayload,
    context?: Record<string, unknown>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let queue = this.queues.get(webhookUrl);
      if (queue === undefined) {
        queue = {
          messages: [],
          processing: false,
          backoffUntil: 0,
        };
        this.queues.set(webhookUrl, queue);
      }

      queue.messages.push({
        payload,
        resolve,
        reject,
        retryCount: 0,
        context,
      });

      // Start processing if not already running.
      if (!queue.processing) {
        void this.processQueue(webhookUrl, queue);
      }
    });
  }

  private async processQueue(
    webhookUrl: string,
    queue: UrlQueue,
  ): Promise<void> {
    if (queue.processing) {
      return;
    }

    queue.processing = true;

    while (queue.messages.length > 0) {
      // Wait for any backoff period.
      const now = Date.now();
      if (queue.backoffUntil > now) {
        const waitTime = queue.backoffUntil - now;
        logger.debug('discord_client_backoff_wait', {
          webhookUrl: this.maskUrl(webhookUrl),
          waitMs: waitTime,
          queueLength: queue.messages.length,
        });
        await this.sleep(waitTime);
      }

      const message = queue.messages[0];
      const result = await this.deliverMessage(webhookUrl, queue, message);

      if (result === DeliveryResult.SUCCESS) {
        queue.messages.shift();
        message.resolve();
      } else if (result === DeliveryResult.PERMANENT_FAILURE) {
        queue.messages.shift();
        message.reject(
          new Error('Discord webhook delivery failed: client error'),
        );
      } else if (message.retryCount >= MAX_RETRIES) {
        queue.messages.shift();
        message.reject(
          new Error(
            `Discord webhook delivery failed after ${MAX_RETRIES} retries`,
          ),
        );
      }
      // If result is RETRY and retries remain, the message stays at the front
      // of the queue and will be retried after backoff.
    }

    queue.processing = false;
  }

  private async deliverMessage(
    webhookUrl: string,
    queue: UrlQueue,
    message: QueuedMessage,
  ): Promise<DeliveryResult> {
    const prepareRetry = (retryAfterMs?: number) => {
      const backoffMs =
        retryAfterMs ?? this.calculateBackoff(message.retryCount);
      queue.backoffUntil = Date.now() + backoffMs;
      message.retryCount++;
    };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message.payload),
      });

      if (response.ok) {
        logger.info('discord_webhook_delivered', {
          ...message.context,
          webhookUrl: this.maskUrl(webhookUrl),
          attempt: message.retryCount + 1,
        });
        return DeliveryResult.SUCCESS;
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        prepareRetry(retryAfter ? parseFloat(retryAfter) * 1000 : undefined);

        logger.warn('discord_webhook_rate_limited', {
          ...message.context,
          webhookUrl: this.maskUrl(webhookUrl),
          attempt: message.retryCount,
        });

        return DeliveryResult.RETRY;
      }

      // 4xx errors (other than 429) are permanent failures.
      if (response.status >= 400 && response.status < 500) {
        logger.warn('discord_webhook_client_error', {
          ...message.context,
          webhookUrl: this.maskUrl(webhookUrl),
          status: response.status,
          statusText: response.statusText,
        });
        return DeliveryResult.PERMANENT_FAILURE;
      }

      prepareRetry();

      logger.warn('discord_webhook_server_error', {
        ...message.context,
        webhookUrl: this.maskUrl(webhookUrl),
        status: response.status,
        statusText: response.statusText,
        attempt: message.retryCount,
      });

      return DeliveryResult.RETRY;
    } catch (e) {
      // Network error.
      prepareRetry();

      logger.error('discord_webhook_network_error', {
        ...message.context,
        webhookUrl: this.maskUrl(webhookUrl),
        error: e instanceof Error ? e.message : String(e),
        attempt: message.retryCount,
      });

      return DeliveryResult.RETRY;
    }
  }

  /**
   * Calculates exponential backoff delay.
   * @param retryCount The current retry attempt (0-indexed).
   * @returns The backoff delay in milliseconds.
   */
  private calculateBackoff(retryCount: number): number {
    return INITIAL_BACKOFF_MS * Math.pow(2, retryCount);
  }

  /**
   * Masks a webhook URL for safe logging by hiding the token.
   */
  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/');
      if (pathParts.length >= 4) {
        // Discord webhook URLs have format: /api/webhooks/{id}/{token}
        pathParts[pathParts.length - 1] = '***';
        parsed.pathname = pathParts.join('/');
      }
      return parsed.toString();
    } catch {
      return '***';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
