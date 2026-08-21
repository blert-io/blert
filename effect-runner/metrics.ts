import http from 'node:http';

import { collectDefaultMetrics, Registry } from 'prom-client';

import logger from './log';

const register = new Registry();
collectDefaultMetrics({ register });

/**
 * Starts an HTTP server for Prometheus metrics.
 * @param port Port to listen on.
 * @returns The running server.
 */
export function startMetricsListener(port: number): http.Server {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });
  server.listen(port, () => logger.info('metrics_listener_started', { port }));
  return server;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }

  const path = req.url?.split('?', 1)[0];
  if (path !== '/metrics') {
    res.writeHead(404).end();
    return;
  }

  try {
    const metrics = await register.metrics();
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(metrics);
  } catch (e) {
    logger.error('metrics_collection_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    res.writeHead(500).end();
  }
}
