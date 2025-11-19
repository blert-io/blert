import { getRequestIp, getTrustedRequestIp } from '@/utils/headers';

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
});
