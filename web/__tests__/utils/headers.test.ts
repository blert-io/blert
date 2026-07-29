import {
  getRequestIp,
  getTrustedRequestIp,
  ipSubnetBucket,
} from '@/utils/headers';

describe('headers', () => {
  describe('getRequestIp', () => {
    it('prefers the first value in x-forwarded-for header', () => {
      const headers = new Headers({
        'x-forwarded-for': '203.0.113.1, 10.0.0.5',
      });

      expect(getRequestIp(headers)).toBe('203.0.113.1');
    });

    it('falls back to x-real-ip when x-forwarded-for is missing', () => {
      const headers = new Headers({
        'x-real-ip': '198.51.100.7',
      });

      expect(getRequestIp(headers)).toBe('198.51.100.7');
    });

    it('returns provided remote address when no proxy headers exist', () => {
      const headers = new Headers();

      expect(getRequestIp(headers, { remoteAddress: '10.1.2.3' })).toBe(
        '10.1.2.3',
      );
    });

    it('defaults to 127.0.0.1 when all sources are missing', () => {
      expect(getRequestIp(new Headers())).toBe('127.0.0.1');
    });
  });

  describe('getTrustedRequestIp', () => {
    it('returns the forwarded IP when present', () => {
      const headers = new Headers({
        'x-forwarded-for': '2001:db8::1',
      });

      expect(getTrustedRequestIp(headers)).toBe('2001:db8::1');
    });

    it('falls back to the runtime remote address', () => {
      const headers = new Headers();

      expect(
        getTrustedRequestIp(headers, { remoteAddress: '192.0.2.55' }),
      ).toBe('192.0.2.55');
    });

    it('returns null when no IP can be determined', () => {
      expect(getTrustedRequestIp(new Headers())).toBeNull();
    });
  });

  describe('ipSubnetBucket', () => {
    it('buckets IPv4 addresses into a /24', () => {
      expect(ipSubnetBucket('203.0.113.45')).toBe('203.0.113.0/24');
      expect(ipSubnetBucket('43.119.100.151')).toBe('43.119.100.0/24');
    });

    it('buckets IPv6 addresses into a /64', () => {
      expect(ipSubnetBucket('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe(
        '2001:db8:85a3:8d3::/64',
      );
    });

    it('expands compressed IPv6 addresses', () => {
      expect(ipSubnetBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
      expect(ipSubnetBucket('::1')).toBe('0:0:0:0::/64');
    });

    it('lowercases IPv6 groups', () => {
      expect(ipSubnetBucket('2001:DB8:85A3:8D3:1319:8A2E:370:7348')).toBe(
        '2001:db8:85a3:8d3::/64',
      );
    });

    it('ignores zone indices', () => {
      expect(ipSubnetBucket('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    });

    it('buckets IPv4-mapped addresses by their embedded IPv4 /24', () => {
      expect(ipSubnetBucket('::ffff:192.0.2.128')).toBe('192.0.2.0/24');
      expect(ipSubnetBucket('0:0:0:0:0:ffff:192.0.2.128')).toBe('192.0.2.0/24');
      expect(ipSubnetBucket('::FFFF:192.0.2.128')).toBe('192.0.2.0/24');
      expect(ipSubnetBucket('0000:0000:0000:0000:0000:ffff:192.0.2.128')).toBe(
        '192.0.2.0/24',
      );
    });

    it('keeps the /64 for non-mapped addresses with an IPv4 tail', () => {
      expect(ipSubnetBucket('2001:db8::192.0.2.1')).toBe('2001:db8:0:0::/64');
    });

    it('normalizes leading zeros in IPv6 groups', () => {
      expect(ipSubnetBucket('2001:0db8:85a3:08d3::1')).toBe(
        '2001:db8:85a3:8d3::/64',
      );
    });

    it('returns unparseable inputs unchanged', () => {
      expect(ipSubnetBucket('not-an-ip')).toBe('not-an-ip');
      expect(ipSubnetBucket('300.0.113.45')).toBe('300.0.113.45');
      expect(ipSubnetBucket('203.0.113')).toBe('203.0.113');
      expect(ipSubnetBucket('2001:db8::1::2')).toBe('2001:db8::1::2');
      expect(ipSubnetBucket('')).toBe('');
    });
  });
});
