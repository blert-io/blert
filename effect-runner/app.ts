import './env';

import { Config, loadConfig } from './config';
import { connect as connectDatabase } from './db';
import { DiscordWebhook } from './delivery/discord';
import {
  FeedHandler,
  RecordsHandler,
  logHandler,
  subscriptionsOf,
} from './handlers';
import logger from './log';
import { startMetricsListener } from './metrics';
import { connect as connectRedis } from './redis';
import { Dispatcher, EffectHandler, EffectStore, Poller } from './runner';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (e) {
    logger.error('config_invalid', {
      error: e instanceof Error ? e.message : String(e),
    });
    process.exit(1);
  }

  const metricsListener = startMetricsListener(config.port);

  const sql = connectDatabase(config.databaseUri);
  const redis = await connectRedis(config.redisUri);
  const store = new EffectStore(sql);

  const handlers: EffectHandler[] = [new FeedHandler(sql, redis)];
  if (config.recordsWebhookUrl !== null) {
    handlers.push(
      new RecordsHandler(
        sql,
        new DiscordWebhook(config.recordsWebhookUrl),
        config.baseUrl,
      ),
    );
  } else {
    logger.warn('records_handler_disabled', {
      reason: 'BLERT_DISCORD_RECORDS_WEBHOOK_URL is unset',
    });
  }
  if (process.env.NODE_ENV === 'development') {
    handlers.push(logHandler);
  }
  const subscriptions = subscriptionsOf(handlers);

  try {
    await store.registerSubscriptions(subscriptions);
  } catch (e) {
    logger.error('registration_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    process.exit(1);
  }

  const dispatcher = new Dispatcher(store, handlers);
  const poller = new Poller(
    store,
    dispatcher,
    subscriptions,
    config.pollIntervalMs,
  );
  poller.start();

  logger.info('effect_runner_started', {
    port: config.port,
    handlers: handlers.map((h) => h.key),
    commit: process.env.BLERT_COMMIT_SHA ?? 'unknown',
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info('shutdown_started', { signal });

    const forcedShutdown = setTimeout(() => {
      logger.error('shutdown_timed_out');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forcedShutdown.unref();

    try {
      await poller.stop();
      await Promise.allSettled([redis.quit(), sql.end()]);

      const closed = new Promise<void>((resolve, reject) => {
        metricsListener.close((err) =>
          err !== undefined ? reject(err) : resolve(),
        );
      });
      metricsListener.closeIdleConnections();
      await closed;

      logger.info('shutdown_complete');
      process.exit(0);
    } catch (e) {
      logger.error('shutdown_error', {
        error: e instanceof Error ? e.message : String(e),
      });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
