type RequestIpOptions = {
  /**
   * Remote address reported by the runtime (e.g., `NextRequest.ip`).
   */
  remoteAddress?: string | null;
  /**
   * Fallback IP when no proxy headers are present.
   * Use `null` to signal that an IP is required.
   *
   * @default '127.0.0.1'
   */
  fallback?: string | null;
};

function extractForwardedIp(headers: Headers): string | null {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ip = forwardedFor.split(',')[0]?.trim();
    if (ip) {
      return ip;
    }
  }

  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  return null;
}

function resolveIp(
  headers: Headers,
  options?: RequestIpOptions,
): string | null {
  const forwardedIp = extractForwardedIp(headers);
  if (forwardedIp) {
    return forwardedIp;
  }

  if (options?.remoteAddress) {
    return options.remoteAddress;
  }

  return options?.fallback ?? null;
}

/**
 * Extracts the IP address from the request headers. Falls back to 127.0.0.1
 * when no proxy headers are present.
 *
 * @param headers The request headers.
 * @param options Optional overrides for remote address/fallback behavior.
 * @returns The IP address of the request.
 */
export function getRequestIp(
  headers: Headers,
  options?: Omit<RequestIpOptions, 'fallback'>,
): string {
  const fallback = '127.0.0.1';
  return resolveIp(headers, { ...options, fallback }) ?? fallback;
}

/**
 * Resolves the client IP address when proxy headers are required. Returns null
 * if the IP cannot be determined, allowing callers to guard against
 * misconfigured deployments.
 *
 * @param headers The request headers.
 * @param options Optional overrides for remote address/fallback behavior.
 * @returns The resolved IP, or null when unavailable.
 */
export function getTrustedRequestIp(
  headers: Headers,
  options?: Omit<RequestIpOptions, 'fallback'>,
): string | null {
  return resolveIp(headers, { ...options, fallback: null });
}
