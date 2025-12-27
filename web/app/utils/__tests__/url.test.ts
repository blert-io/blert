import { validateRedirectUrl } from '../url';

describe('validateRedirectUrl', () => {
  it('returns "/" for undefined', () => {
    expect(validateRedirectUrl(undefined)).toBe('/');
  });

  it('allows valid relative paths', () => {
    expect(validateRedirectUrl('/')).toBe('/');
    expect(validateRedirectUrl('/login')).toBe('/login');
    expect(validateRedirectUrl('/raids/tob/123')).toBe('/raids/tob/123');
    expect(validateRedirectUrl('/path?query=value')).toBe('/path?query=value');
    expect(validateRedirectUrl('/path#anchor')).toBe('/path#anchor');
  });

  it('rejects protocol-relative URLs', () => {
    expect(validateRedirectUrl('//evil.com')).toBe('/');
    expect(validateRedirectUrl('//evil.com/path')).toBe('/');
  });

  it('rejects absolute URLs with protocols', () => {
    expect(validateRedirectUrl('https://evil.com')).toBe('/');
    expect(validateRedirectUrl('http://evil.com')).toBe('/');
    expect(validateRedirectUrl('https://evil.com/path')).toBe('/');
  });

  it('rejects javascript: URLs', () => {
    expect(validateRedirectUrl('javascript:alert(1)')).toBe('/');
  });

  it('rejects data: URLs', () => {
    expect(
      validateRedirectUrl('data:text/html,<script>alert(1)</script>'),
    ).toBe('/');
  });

  it('rejects paths not starting with /', () => {
    expect(validateRedirectUrl('path/to/page')).toBe('/');
    expect(validateRedirectUrl('evil.com/path')).toBe('/');
  });

  it('rejects empty string', () => {
    expect(validateRedirectUrl('')).toBe('/');
  });

  it('rejects backslash URLs (browser normalization bypass)', () => {
    expect(validateRedirectUrl('/\\evil.com')).toBe('/');
    expect(validateRedirectUrl('/\\\\evil.com')).toBe('/');
  });
});
