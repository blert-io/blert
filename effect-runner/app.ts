import './env';

import { Config, loadConfig } from './config';
import logger from './log';
import { startMetricsListener } from './metrics';

function main() {
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

  // TODO(frolv): Start the effect event poll loop once it exists.

  logger.info('effect_runner_started', {
    port: config.port,
    commit: process.env.BLERT_COMMIT_SHA ?? 'unknown',
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info('shutdown_started', { signal });

    metricsListener.close(() => process.exit(0));
    metricsListener.closeIdleConnections();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
