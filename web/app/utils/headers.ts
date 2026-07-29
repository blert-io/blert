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

/**
 * Maps an IP address to its subnet bucket used for rate limiting.
 * Inputs which are not parseable as either IPv4 or IPv6 are returned unchanged
 * so they still form a limitable bucket.
 *
 * @param ip The IP address to bucket.
 * @returns The subnet identifier for the IP.
 */
export function ipSubnetBucket(ip: string): string {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (ipv4 !== null) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.every((o) => o <= 255)) {
      return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
    }
    return ip;
  }

  if (ip.includes(':')) {
    const expanded = expandIpv6(ip);
    if (expanded !== null) {
      const v4Tail = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
      if (
        v4Tail !== null &&
        expanded.slice(0, 5).every((group) => group === '0') &&
        expanded[5] === 'ffff'
      ) {
        return ipSubnetBucket(v4Tail[1]);
      }
      return `${expanded.slice(0, 4).join(':')}::/64`;
    }
  }

  return ip;
}

function expandIpv6(ip: string): string[] | null {
  let address = ip;

  // Strip the zone index and any embedded IPv4 tail.
  const zoneIndex = address.indexOf('%');
  if (zoneIndex !== -1) {
    address = address.slice(0, zoneIndex);
  }
  address = address.replace(/:\d{1,3}(\.\d{1,3}){3}$/, ':0:0');

  const doubleColons = address.split('::');
  if (doubleColons.length > 2) {
    return null;
  }

  const isGroup = (g: string) => /^[0-9a-fA-F]{1,4}$/.test(g);

  let groups: string[];
  if (doubleColons.length === 2) {
    const head = doubleColons[0] === '' ? [] : doubleColons[0].split(':');
    const tail = doubleColons[1] === '' ? [] : doubleColons[1].split(':');
    if (head.length + tail.length > 7) {
      return null;
    }
    const fill = Array<string>(8 - head.length - tail.length).fill('0');
    groups = [...head, ...fill, ...tail];
  } else {
    groups = address.split(':');
  }

  if (groups.length !== 8 || !groups.every(isGroup)) {
    return null;
  }

  return groups.map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''));
}
