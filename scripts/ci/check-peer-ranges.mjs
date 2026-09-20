#!/usr/bin/env node
/* global console */

// A script that checks that all npm peer dependencies required by the repo
// resolve correctly.
//
// It fails when a package the repo depends on directly declares a peer range
// that the version resolved for it does not satisfy. npm reports these as
// warnings and exits zero, allowing broken dependencies to silently land.
// Peer ranges declared by transitive packages are not checked.

import { readFileSync } from 'node:fs';
import semver from 'semver';

const { packages } = JSON.parse(readFileSync('package-lock.json', 'utf8'));

/** Every package named by the root manifest or a workspace manifest. */
const direct = new Set(
  Object.entries(packages)
    .filter(
      ([location, node]) =>
        node.link !== true && !location.includes('node_modules/'),
    )
    .flatMap(([, node]) => [
      ...Object.keys(node.dependencies ?? {}),
      ...Object.keys(node.devDependencies ?? {}),
    ]),
);

/**
 * Resolves `name` from `location` the way Node would, returning null if absent.
 */
function resolveFrom(location, name) {
  for (let dir = location; ;) {
    const node = packages[`${dir === '' ? '' : `${dir}/`}node_modules/${name}`];
    if (node !== undefined) {
      return node.link === true ? (packages[node.resolved] ?? null) : node;
    }
    if (dir === '') {
      return null;
    }
    const nested = dir.lastIndexOf('/node_modules/');
    dir = nested === -1 ? '' : dir.slice(0, nested);
  }
}

let failed = false;

for (const [location, node] of Object.entries(packages)) {
  const marker = location.lastIndexOf('node_modules/');
  if (node.link === true || marker === -1) {
    continue;
  }
  const name = location.slice(marker + 'node_modules/'.length);
  if (!direct.has(name)) {
    continue;
  }
  for (const [peer, range] of Object.entries(node.peerDependencies ?? {})) {
    const got = resolveFrom(location, peer)?.version;
    if (
      node.peerDependenciesMeta?.[peer]?.optional === true ||
      semver.validRange(range) === null ||
      got === undefined ||
      semver.satisfies(got, range)
    ) {
      continue;
    }
    console.error(
      `✗ ${name}@${node.version} supports ${peer}@"${range}", but ${peer}@${got} is installed`,
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log('✓ peer ranges of direct dependencies are satisfied');
