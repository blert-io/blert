export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { default: logger } = await import('@/utils/log');
    logger.info('web_server_starting', {
      nodeEnv: process.env.NODE_ENV,
      port: process.env.PORT ?? '3000',
      commit: process.env.BLERT_COMMIT_SHA ?? 'unknown',
    });

    // Eagerly initialize the metrics registry so collectDefaultMetrics starts.
    await import('@/utils/metrics');
  }
}
