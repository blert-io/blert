import logger from '../log';

/**
 * Interface that all webhook handlers must implement.
 */
export interface WebhookHandler {
  /** A unique name for this handler, used for logging. */
  readonly name: string;

  /**
   * Called when a challenge completes successfully.
   * @param challengeUuid The UUID of the completed challenge.
   */
  onChallengeComplete(challengeUuid: string): Promise<void>;
}

/**
 * A general-purpose notification service that reacts to challenge events.
 * Uses a handler pattern where different handlers can be registered to process
 * events in different ways.
 */
export class WebhookService {
  private readonly handlers: WebhookHandler[] = [];
  private enabled: boolean;

  constructor() {
    const envEnabled = process.env.BLERT_WEBHOOKS_ENABLED;
    this.enabled = envEnabled === '1' || envEnabled?.toLowerCase() === 'true';

    if (!this.enabled) {
      logger.info('webhook_service_disabled');
    }
  }

  /**
   * Registers a handler to receive challenge events.
   * @param handler The handler to register.
   */
  public registerHandler(handler: WebhookHandler): void {
    this.handlers.push(handler);
    logger.info('webhook_handler_registered', { handler: handler.name });
  }

  /**
   * Notifies all registered handlers that a challenge has completed.
   * Handlers are invoked concurrently but failures in one handler do not
   * affect other handlers.
   *
   * @param challengeUuid The UUID of the completed challenge.
   */
  public async onChallengeComplete(challengeUuid: string): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (this.handlers.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      this.handlers.map((handler) =>
        handler.onChallengeComplete(challengeUuid).catch((e) => {
          logger.error('webhook_handler_error', {
            handler: handler.name,
            challengeUuid,
            error: e instanceof Error ? e.message : String(e),
          });
          throw e;
        }),
      ),
    );

    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      logger.warn('webhook_handlers_failed', {
        challengeUuid,
        failedCount: failures.length,
        totalCount: this.handlers.length,
      });
    }
  }

  /**
   * Returns whether the webhook service is enabled.
   */
  public isEnabled(): boolean {
    return this.enabled;
  }
}
