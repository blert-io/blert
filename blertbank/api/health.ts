import { Request, Response } from 'express';

import sql from '@/db';

const START_TIME = Date.now();

export function ping(_req: Request, res: Response): void {
  res.send('pong');
}

export async function getHealth(_req: Request, res: Response): Promise<void> {
  let databaseStatus = 'unknown';

  try {
    await sql`SELECT 1`;
    databaseStatus = 'connected';
  } catch {
    databaseStatus = 'unreachable';
  }

  const uptimeSeconds = Math.floor((Date.now() - START_TIME) / 1000);

  res.json({
    status: databaseStatus === 'connected' ? 'healthy' : 'unhealthy',
    database: databaseStatus,
    version: process.env.npm_package_version ?? 'unknown',
    uptime: uptimeSeconds,
  });
}
