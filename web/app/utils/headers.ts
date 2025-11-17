/**
 * Extracts the IP address from the request headers.
 * @param headers The request headers.
 * @returns The IP address of the request.
 */
export function getRequestIp(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for');
  const realIp = headers.get('x-real-ip');
  return forwardedFor?.split(',')[0] ?? realIp ?? '127.0.0.1';
}
