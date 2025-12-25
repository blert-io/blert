process.env.BLERTBANK_SERVICE_TOKEN = 'test-token';
process.env.BLERTBANK_DATABASE_URI = 'postgres://test:test@localhost:5432/test';

import request from 'supertest';

import type { AccountRow } from '@/core/accounts';

jest.mock('@/db');
jest.mock('@/core/accounts');

import { createApp } from '@/app';
import * as accountsCore from '@/core/accounts';

const mockedAccountsCore = jest.mocked(accountsCore);

const mockAccount: AccountRow = {
  id: 123,
  ownerUserId: 456,
  kind: 'user',
  balance: 1000,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-02T00:00:00Z'),
};

describe('POST /accounts', () => {
  const app = createApp();

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns 201 when creating a new account', async () => {
    mockedAccountsCore.getOrCreateUserAccount.mockResolvedValue({
      account: mockAccount,
      created: true,
    });

    const res = await request(app)
      .post('/accounts')
      .set('X-Service-Token', 'test-token')
      .send({ userId: 456 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      accountId: 123,
      kind: 'user',
      userId: 456,
      balance: 1000,
    });
    expect(mockedAccountsCore.getOrCreateUserAccount).toHaveBeenCalledWith(456);
  });

  it('returns 200 when account already exists', async () => {
    mockedAccountsCore.getOrCreateUserAccount.mockResolvedValue({
      account: mockAccount,
      created: false,
    });

    const res = await request(app)
      .post('/accounts')
      .set('X-Service-Token', 'test-token')
      .send({ userId: 456 });

    expect(res.status).toBe(200);
    expect(res.body.accountId).toBe(123);
  });

  it('returns 400 for non-integer userId', async () => {
    const res = await request(app)
      .post('/accounts')
      .set('X-Service-Token', 'test-token')
      .send({ userId: 'not-a-number' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BAD_REQUEST');
  });

  it('returns 400 for missing userId', async () => {
    const res = await request(app)
      .post('/accounts')
      .set('X-Service-Token', 'test-token')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BAD_REQUEST');
  });

  it('returns 400 for float userId', async () => {
    const res = await request(app)
      .post('/accounts')
      .set('X-Service-Token', 'test-token')
      .send({ userId: 123.45 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BAD_REQUEST');
  });

  it('returns 401 without service token', async () => {
    const res = await request(app).post('/accounts').send({ userId: 456 });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });
});

describe('GET /accounts/user/:userId', () => {
  const app = createApp();

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns account when found', async () => {
    mockedAccountsCore.findUserAccountByUserId.mockResolvedValue(mockAccount);

    const res = await request(app)
      .get('/accounts/user/456')
      .set('X-Service-Token', 'test-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      accountId: 123,
      kind: 'user',
      userId: 456,
      balance: 1000,
    });
    expect(mockedAccountsCore.findUserAccountByUserId).toHaveBeenCalledWith(
      456,
    );
  });

  it('returns 404 when account does not exist', async () => {
    mockedAccountsCore.findUserAccountByUserId.mockResolvedValue(null);

    const res = await request(app)
      .get('/accounts/user/456')
      .set('X-Service-Token', 'test-token');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ACCOUNT_NOT_FOUND');
  });

  it('returns 400 for non-numeric userId param', async () => {
    const res = await request(app)
      .get('/accounts/user/abc')
      .set('X-Service-Token', 'test-token');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BAD_REQUEST');
  });

  it('returns 401 without service token', async () => {
    const res = await request(app).get('/accounts/user/456');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });
});
