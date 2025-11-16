import express, { Application } from 'express';

import { apiErrorHandler, registerApiRoutes } from './api';
import logger, { requestLogger } from './log';

export function createApp(): Application {
  const app = express();

  app.use(express.json());
  app.use(requestLogger);

  registerApiRoutes(app);
  app.use(apiErrorHandler);

  return app;
}

async function main() {
  const app = createApp();
  const port = process.env.PORT ?? 3003;

  app.listen(port, () => {
    logger.info('Blertbank server started on port %d', port);
  });
}

if (require.main === module) {
  main().catch((err) => {
    logger.error('Error starting Blertbank server', {
      event: 'server_start_error',
      error: err,
    });
    process.exit(1);
  });
}
