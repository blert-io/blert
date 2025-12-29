import {
  compareRuneLiteVersions,
  verifyRuneLiteVersion,
  verifyRevision,
} from '../verification';

describe('compareRuneLiteVersions', () => {
  it('should compare equal versions correctly', () => {
    expect(compareRuneLiteVersions('1.11.10', '1.11.10')).toBe(0);
    expect(compareRuneLiteVersions('1.11.10.1', '1.11.10.1')).toBe(0);
  });

  it('should handle major version differences', () => {
    expect(compareRuneLiteVersions('2.0.0', '1.11.10')).toBeGreaterThan(0);
    expect(compareRuneLiteVersions('1.11.10', '2.0.0')).toBeLessThan(0);
  });

  it('should handle minor version differences', () => {
    expect(compareRuneLiteVersions('1.12.0', '1.11.10')).toBeGreaterThan(0);
    expect(compareRuneLiteVersions('1.11.10', '1.12.0')).toBeLessThan(0);
  });

  it('should handle patch version differences', () => {
    expect(compareRuneLiteVersions('1.11.11', '1.11.10')).toBeGreaterThan(0);
    expect(compareRuneLiteVersions('1.11.10', '1.11.11')).toBeLessThan(0);
  });

  it('should handle 4th version component differences', () => {
    expect(compareRuneLiteVersions('1.11.10.1', '1.11.10.0')).toBeGreaterThan(
      0,
    );
    expect(compareRuneLiteVersions('1.11.10.0', '1.11.10.1')).toBeLessThan(0);
    expect(compareRuneLiteVersions('1.11.10.2', '1.11.10.1')).toBeGreaterThan(
      0,
    );
  });

  it('should handle mixed version lengths', () => {
    // 1.11.10 should be treated as 1.11.10.0
    expect(compareRuneLiteVersions('1.11.10.1', '1.11.10')).toBeGreaterThan(0);
    expect(compareRuneLiteVersions('1.11.10', '1.11.10.1')).toBeLessThan(0);
    expect(compareRuneLiteVersions('1.11.10', '1.11.10.0')).toBe(0);
  });

  it('should handle different length versions', () => {
    expect(compareRuneLiteVersions('1.11', '1.11.0.0')).toBe(0);
    expect(compareRuneLiteVersions('1.11.10.1.5', '1.11.10.1')).toBeGreaterThan(
      0,
    );
  });
});

describe('verifyRuneLiteVersion', () => {
  it('should return true when minVersion is undefined', () => {
    expect(verifyRuneLiteVersion('1.11.10.1', null)).toBe(true);
  });

  it('should return false when version is undefined but minVersion is set', () => {
    expect(verifyRuneLiteVersion(undefined, '1.11.10')).toBe(false);
  });

  it('should strip runelite- prefix', () => {
    expect(verifyRuneLiteVersion('runelite-1.11.10.1', '1.11.10')).toBe(true);
  });

  it('should strip -dev suffix', () => {
    expect(verifyRuneLiteVersion('1.11.10.1-dev', '1.11.10')).toBe(true);
  });

  it('should strip other prefixes and suffixes', () => {
    expect(verifyRuneLiteVersion('runelite-1.11.10.1-dev', '1.11.10')).toBe(
      true,
    );
    expect(
      verifyRuneLiteVersion('runelite-1.11.10.1-SNAPSHOT-dev', '1.11.10'),
    ).toBe(true);
    expect(
      verifyRuneLiteVersion('runelite-1.10.9-SNAPSHOT-dev', '1.11.10'),
    ).toBe(false);
    expect(verifyRuneLiteVersion('1.10.9-SNAPSHOT', '1.11.10')).toBe(false);
  });

  it('should accept valid versions that meet minimum', () => {
    expect(verifyRuneLiteVersion('1.11.10.1', '1.11.10')).toBe(true);
    expect(verifyRuneLiteVersion('1.11.10', '1.11.10')).toBe(true);
    expect(verifyRuneLiteVersion('1.12.0', '1.11.10')).toBe(true);
  });

  it('should reject versions below minimum', () => {
    expect(verifyRuneLiteVersion('1.11.9', '1.11.10')).toBe(false);
    expect(verifyRuneLiteVersion('1.11.10.0', '1.11.10.1')).toBe(false);
    expect(verifyRuneLiteVersion('1.10.0', '1.11.10')).toBe(false);
  });

  it('should handle 4-part version comparisons correctly', () => {
    expect(verifyRuneLiteVersion('1.11.10.1', '1.11.10.0')).toBe(true);
    expect(verifyRuneLiteVersion('1.11.10.0', '1.11.10.1')).toBe(false);
    expect(verifyRuneLiteVersion('1.11.10.2', '1.11.10.1')).toBe(true);
  });

  it('should handle 4-part version comparisons with 3-part minimum', () => {
    expect(verifyRuneLiteVersion('1.11.9.100', '1.11.10')).toBe(false);
    expect(verifyRuneLiteVersion('1.11.10.0', '1.11.10')).toBe(true);
    expect(verifyRuneLiteVersion('1.11.10.1', '1.11.10')).toBe(true);
    expect(verifyRuneLiteVersion('1.11.10.2', '1.11.10')).toBe(true);
  });

  it('should handle 3-part version comparisons with 4-part minimum', () => {
    expect(verifyRuneLiteVersion('1.11.10', '1.11.10.0')).toBe(true);
    expect(verifyRuneLiteVersion('1.11.10', '1.11.10.1')).toBe(false);
    expect(verifyRuneLiteVersion('1.11.10', '1.11.10.2')).toBe(false);
    expect(verifyRuneLiteVersion('1.11.11', '1.11.10.2')).toBe(true);
  });

  it('should reject invalid version formats', () => {
    expect(verifyRuneLiteVersion('invalid-version', '1.11.10')).toBe(false);
    expect(verifyRuneLiteVersion('1.11.10', 'invalid-min')).toBe(false);
    expect(verifyRuneLiteVersion('1.11.10.alpha', '1.11.10')).toBe(false);
  });

  it('should accept valid version formats with letters stripped', () => {
    // This should fail because the regex only allows numbers and dots
    expect(verifyRuneLiteVersion('1.11.10a', '1.11.10')).toBe(false);
  });

  it('should handle edge cases', () => {
    expect(verifyRuneLiteVersion('0.0.0', '0.0.0')).toBe(true);
    expect(verifyRuneLiteVersion('999.999.999.999', '1.0.0')).toBe(true);
  });
});

describe('verifyRevision', () => {
  it('should return true when revisions are empty', () => {
    const revisions = new Set<string>();
    expect(verifyRevision(revisions, 'xyz789')).toBe(true);
    expect(verifyRevision(revisions, undefined)).toBe(true);
  });

  it('should return false when revision is undefined and revisions are not empty', () => {
    const revisions = new Set(['abc123', 'def456']);
    expect(verifyRevision(revisions, undefined)).toBe(false);
  });

  it('should return true for valid revisions', () => {
    const revisions = new Set(['abc123', 'def456', 'ghi789']);
    expect(verifyRevision(revisions, 'abc123')).toBe(true);
    expect(verifyRevision(revisions, 'def456')).toBe(true);
    expect(verifyRevision(revisions, 'ghi789')).toBe(true);
  });

  it('should return false for invalid revisions', () => {
    const revisions = new Set(['abc123', 'def456']);
    expect(verifyRevision(revisions, 'xyz789')).toBe(false);
    expect(verifyRevision(revisions, 'invalid')).toBe(false);
  });
});
