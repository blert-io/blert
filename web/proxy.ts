import { NextRequest, NextResponse } from 'next/server';

import { getRateLimitKey, rateLimit } from '@/utils/rate-limit';
import { getTrustedRequestIp } from '@/utils/headers';

import { RateLimitConfig } from '@/utils/rate-limit';

type RouteMatcher = {
  test: (pathname: string) => boolean;
  config: RateLimitConfig;
};

const RATE_LIMITS: RouteMatcher[] = [
  {
    test: (path) => path.startsWith('/api/admin/verify-link'),
    config: {
      limit: 5,
      windowSec: 60,
      keyPrefix: 'ratelimit:admin:verify',
    },
  },
  {
    test: (path) => path.startsWith('/api/admin/grant-api-access'),
    config: {
      limit: 30,
      windowSec: 60,
      keyPrefix: 'ratelimit:admin:grant',
    },
  },
  {
    test: (path) => /^\/api\/v1\/.+\/events/.test(path),
    config: {
      limit: 30,
      windowSec: 60,
      keyPrefix: 'ratelimit:v1:events',
    },
  },
  {
    test: (path) => path.startsWith('/api/v1/challenges/stats'),
    config: {
      limit: 60,
      windowSec: 60,
      keyPrefix: 'ratelimit:v1:challenge-stats',
    },
  },
  {
    test: (path) => /^\/api\/(activity|setups|suggest)(\/|$)/.test(path),
    config: {
      limit: 100,
      windowSec: 60,
      keyPrefix: 'ratelimit:internal',
    },
  },
  {
    test: (path) => path.startsWith('/api/admin/'),
    config: {
      limit: 60,
      windowSec: 60,
      keyPrefix: 'ratelimit:admin:default',
    },
  },
  {
    test: (path) => path.startsWith('/api/v1/'),
    config: {
      limit: 80,
      windowSec: 60,
      keyPrefix: 'ratelimit:v1:default',
    },
  },
];

const DISABLED_RATE_LIMIT: RateLimitConfig = {
  limit: Infinity,
  windowSec: 60,
  keyPrefix: 'ratelimit:disabled',
};

function rateLimitForPath(pathname: string): RateLimitConfig {
  const matcher = RATE_LIMITS.find(({ test }) => test(pathname));
  return matcher?.config ?? DISABLED_RATE_LIMIT;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  const config = rateLimitForPath(pathname);
  if (!Number.isFinite(config.limit)) {
    return NextResponse.next();
  }

  const ip = getTrustedRequestIp(request.headers, {
    // @ts-expect-error: NextRequest.ip is not typed.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    remoteAddress: request.ip,
  });
  if (ip === null) {
    console.warn('Rate limit proxy: missing client IP', {
      url: pathname,
      method: request.method,
    });
    return NextResponse.json(
      {
        error: 'internal_server_error',
      },
      { status: 500 },
    );
  }

  const key = getRateLimitKey(config, ip);
  const result = await rateLimit(key, config.limit, config.windowSec);

  const response = result.success
    ? NextResponse.next()
    : NextResponse.json(
        {
          error: 'rate_limit_exceeded',
          message: 'Too many requests, please try again later.',
          limit: result.limit,
          reset: result.reset,
        },
        { status: 429 },
      );

  response.headers.set('X-RateLimit-Limit', String(result.limit));
  response.headers.set('X-RateLimit-Remaining', String(result.remaining));
  response.headers.set('X-RateLimit-Reset', String(result.reset));

  if (!result.success) {
    const retryAfter = Math.max(
      1,
      result.reset - Math.floor(Date.now() / 1000),
    );
    response.headers.set('Retry-After', String(retryAfter));
  }

  return response;
}

export const config = {
  matcher: [
    '/api/v1/:path*',
    '/api/admin/:path*',
    '/api/activity/:path*',
    '/api/setups/:path*',
    '/api/suggest/:path*',
  ],
};
