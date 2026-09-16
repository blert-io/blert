import { NextRequest } from 'next/server';

export function apiRequest(
  path: string,
  params: Record<string, string> = {},
): NextRequest {
  const url = new URL(`http://localhost:3000${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}
