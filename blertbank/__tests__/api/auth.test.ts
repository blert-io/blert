process.env.BLERTBANK_SERVICE_TOKEN = 'test-token';

import type { Request, Response, NextFunction } from 'express';
import { requireServiceAuth } from '../../api/auth';
import { ApiError, ApiErrorCode } from '../../api/error';

function makeMockReq(headers: Record<string, string> = {}): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()] ?? headers[name],
  } as any;
}

function makeMockRes(): { res: Response; locals: any } {
  const locals: any = {};
  const res = { locals } as Response;
  return { res, locals };
}

describe('requireServiceAuth', () => {
  it('successfully calls next with valid service token', () => {
    const req = makeMockReq({ 'X-Service-Token': 'test-token' });
    const { res, locals } = makeMockRes();
    const next = jest.fn();

    requireServiceAuth(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledWith();
    expect(locals.serviceName).toBe('unknown');
  });

  it('stores service name in locals', () => {
    const req = makeMockReq({
      'X-Service-Token': 'test-token',
      'X-Service-Name': 'test-service',
    });
    const { res, locals } = makeMockRes();
    const next = jest.fn();

    requireServiceAuth(req, res, next as unknown as NextFunction);

    expect(locals.serviceName).toBe('test-service');
  });

  it('fails with missing service token', () => {
    const req = makeMockReq();
    const { res } = makeMockRes();
    const next = jest.fn();

    requireServiceAuth(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0] as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe(ApiErrorCode.UNAUTHORIZED);
  });
});
