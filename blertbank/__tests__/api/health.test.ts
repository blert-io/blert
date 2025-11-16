process.env.BLERTBANK_SERVICE_TOKEN = 'test-token';

import request from 'supertest';

jest.mock('../../db', () => ({
  __esModule: true,
  default: jest.fn(() => Promise.resolve([{ '?column?': 1 }])),
}));

import { createApp } from '../../app';

describe('Health check endpoints', () => {
  const app = createApp();

  it('GET /ping responds with pong', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(res.text).toBe('pong');
  });

  it('GET /health responds with health status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.database).toBe('connected');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });
});
