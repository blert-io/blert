import { IncomingHttpHeaders } from 'http';

/**
 * Represents the versions of a connected Blert plugin.
 */
export class PluginVersions {
  private static readonly VERSION_HEADER = 'blert-version';
  private static readonly REVISION_HEADER = 'blert-revision';
  private static readonly RUNELITE_VERSION_HEADER = 'blert-runelite-version';

  public static fromHeaders(
    headers: IncomingHttpHeaders,
  ): PluginVersions | null {
    const version = headers[PluginVersions.VERSION_HEADER] as
      | string
      | undefined;
    let revision = headers[PluginVersions.REVISION_HEADER] as
      | string
      | undefined;
    revision = revision?.split(':')[0];
    const runeLiteVersion = headers[PluginVersions.RUNELITE_VERSION_HEADER] as
      | string
      | undefined;

    if (!revision || !version || !runeLiteVersion) {
      return null;
    }

    return new PluginVersions(version, revision, runeLiteVersion);
  }

  public getVersion(): string {
    return this.version;
  }

  public getRevision(): string {
    return this.revision;
  }

  public getRuneLiteVersion(): string {
    return this.runeLiteVersion;
  }

  public toString(): string {
    const version = `v${this.version}`;
    const revision = `${this.revision.slice(0, 8)}`;
    return `${version}-${revision}@${this.runeLiteVersion}`;
  }

  private constructor(
    public readonly version: string,
    public readonly revision: string,
    public readonly runeLiteVersion: string,
  ) {}
}

/**
 * Compare RuneLite-style version numbers that may have 4 parts
 * (major.minor.patch.build).
 *
 * @param version1 The first version to compare.
 * @param version2 The second version to compare.
 * @returns A negative number if `version1` is less than `version2`, a positive
 * number if `version1` is greater than `version2`, or 0 if they are equal.
 */
export function compareRuneLiteVersions(
  version1: string,
  version2: string,
): number {
  const parts1 = version1.split('.').map(Number);
  const parts2 = version2.split('.').map(Number);

  const maxLength = Math.max(parts1.length, parts2.length);
  while (parts1.length < maxLength) {
    parts1.push(0);
  }
  while (parts2.length < maxLength) {
    parts2.push(0);
  }

  for (let i = 0; i < maxLength; i++) {
    if (parts1[i] !== parts2[i]) {
      return parts1[i] - parts2[i];
    }
  }

  return 0;
}

/**
 * Verify that a RuneLite version is at least as new as the minimum version.
 * If `minVersion` is not provided, the version is always considered valid.
 *
 * @param version The version to verify.
 * @param minVersion The minimum version.
 * @returns True if the version is at least as new as the minimum version.
 */
export function verifyRuneLiteVersion(
  version: string | undefined,
  minVersion: string | null,
): boolean {
  if (minVersion === null) {
    return true;
  }

  if (version === undefined) {
    return false;
  }

  // This prefix and suffix are added by Blert; strip them to get the RuneLite
  // version string.
  let cleanVersion = version;
  if (cleanVersion.startsWith('runelite-')) {
    cleanVersion = cleanVersion.slice('runelite-'.length);
  }
  if (cleanVersion.endsWith('-dev')) {
    cleanVersion = cleanVersion.slice(0, -4);
  }

  // RuneLite versions may also have their own suffixes (e.g., -SNAPSHOT).
  // Strip these to get the core version number
  const versionParts = cleanVersion.split('-');
  if (versionParts.length > 0) {
    cleanVersion = versionParts[0];
  }

  const versionRegex = /^[\d.]+$/;
  if (!versionRegex.test(cleanVersion) || !versionRegex.test(minVersion)) {
    return false;
  }

  const comparison = compareRuneLiteVersions(cleanVersion, minVersion);
  const isValid = comparison >= 0;

  return isValid;
}

/**
 * Verify that a revision is in the set of valid revisions.
 *
 * @param validRevisions The set of valid revisions.
 * @param revision The revision to verify.
 * @returns True if the revision is in the set of valid revisions. If the set
 * is empty, the revision is always considered valid.
 */
export function verifyRevision(
  validRevisions: Set<string>,
  revision: string | undefined,
): boolean {
  if (validRevisions.size === 0) {
    return true;
  }

  if (revision === undefined) {
    return false;
  }

  return validRevisions.has(revision);
}
