process.env.BLERTBANK_SERVICE_TOKEN = 'test-token';

import type { Request, Response, NextFunction } from 'express';

import { requireServiceAuth } from '@/api/auth';
import { ApiError, ApiErrorCode } from '@/api/error';
import { getRequestContext, requestContext } from '@/context';

function makeMockReq(headers: Record<string, string> = {}): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()] ?? headers[name],
  } as any;
}

function makeMockRes(): Response {
  return { locals: {} } as Response;
}

describe('requireServiceAuth', () => {
  it('successfully calls next with valid service token', () => {
    const req = makeMockReq({ 'X-Service-Token': 'test-token' });
    const res = makeMockRes();
    const next = jest.fn();

    requestContext.run({}, () => {
      requireServiceAuth(req, res, next as unknown as NextFunction);

      expect(next).toHaveBeenCalledWith();
      expect(getRequestContext().requestService).toBe('unknown');
    });
  });

  it('stores service name in request context', () => {
    const req = makeMockReq({
      'X-Service-Token': 'test-token',
      'X-Service-Name': 'test-service',
    });
    const res = makeMockRes();
    const next = jest.fn();

    requestContext.run({}, () => {
      requireServiceAuth(req, res, next as unknown as NextFunction);

      expect(getRequestContext().requestService).toBe('test-service');
    });
  });

  it('fails with missing service token', () => {
    const req = makeMockReq();
    const res = makeMockRes();
    const next = jest.fn();

    requireServiceAuth(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0] as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe(ApiErrorCode.UNAUTHORIZED);
  });
});
