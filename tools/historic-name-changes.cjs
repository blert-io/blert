#!/usr/bin/env node
/* global console, fetch, setTimeout, setInterval, clearInterval */
//
// Builds a player's historic name change chain from the Wise Old Man API and
// submits it to Blert's historic name change endpoint.
//
//   BLERT_ADMIN_SECRET=... node tools/historic-name-changes.cjs <username> [options]
//
// The admin secret is read from $BLERT_ADMIN_SECRET, or, if unset, from
// $XDG_CONFIG_HOME/blert/admin-secret.
//
// Options:
//   --apply       Apply the migration instead of previewing it.
//   --base <url>  Blert base URL (default http://localhost:3000).
//   --json        Print the raw JSON response instead of a formatted summary.
//

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');

const { WOMClient } = require('@wise-old-man/utils');
const { normalizeRsn } = require('@blert/common');

const DEFAULT_BASE = 'http://localhost:3000';

const wom = new WOMClient({
  userAgent: 'blert.io',
  apiKey: process.env.WOM_API_KEY,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a Wise Old Man request when rate limited, backing off between tries.
 * The client's `RateLimitError` carries no Retry-After, so the waits are fixed.
 */
async function retryOn429(request) {
  const backoffsMs = [15000, 30000, 60000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (e) {
      if (e && e.statusCode === 429 && attempt < backoffsMs.length) {
        const seconds = backoffsMs[attempt] / 1000;
        console.error(
          `rate limited by Wise Old Man; retrying in ${seconds}s...`,
        );
        await sleep(backoffsMs[attempt]);
        continue;
      }
      throw e;
    }
  }
}

const ERROR_MESSAGES = {
  empty: 'the chain is empty',
  invalid_rsn: 'the chain contains an invalid RuneScape name',
  not_chronological: 'name changes are not in strictly chronological order',
  inconsistent_link:
    'the history has a gap (a rename is missing between two names)',
  unauthorized: 'admin authentication failed (check BLERT_ADMIN_SECRET)',
  invalid_body: 'the server could not parse the request body',
  invalid_chain: 'the server rejected the chain payload',
  invalid_date: 'a transition had an invalid date',
};

function fail(message, code = 1) {
  console.error(`error: ${message}`);
  process.exit(code);
}

function parseCliArgs(argv) {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        apply: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        base: { type: 'string', default: DEFAULT_BASE },
      },
    }));
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e), 2);
  }

  if (positionals.length > 1) {
    fail(
      `unexpected extra arguments: ${positionals.slice(1).join(' ')} ` +
        '(quote names containing spaces, e.g. "Some Player")',
      2,
    );
  }

  return {
    username: positionals[0],
    apply: values.apply,
    json: values.json,
    base: values.base,
  };
}

function toTransition(nc) {
  return {
    oldName: nc.oldName,
    newName: nc.newName,
    effectiveFrom: nc.resolvedAt ?? nc.updatedAt ?? nc.createdAt,
  };
}

function byEffectiveFrom(a, b) {
  return (
    new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime()
  );
}

/** Fetches every approved name change matching a username substring. */
async function searchApprovedNameChanges(username) {
  const limit = 50;
  const results = [];
  for (let offset = 0; ; offset += limit) {
    const page = await retryOn429(() =>
      wom.nameChanges.searchNameChanges({ username }, { limit, offset }),
    );
    for (const nc of page) {
      if (nc.status === 'approved') {
        results.push(nc);
      }
    }
    if (page.length < limit) {
      break;
    }
  }
  return results;
}

/** Builds a player's full name change chain from WOM history. */
async function buildChain(username, onProgress = () => {}) {
  onProgress('fetching current name history from Wise Old Man');

  // Fetch names on the current player record, then walk backwards through name
  // change history from its earliest entry to recover any history that exists
  // on past records.
  const changes = await retryOn429(() => wom.players.getPlayerNames(username));
  const recent = changes
    .map(toTransition)
    .filter((t) => t.effectiveFrom != null)
    .sort(byEffectiveFrom);

  // Maps a normalized name to the approved changes that rename into it.
  const pool = new Map();
  const searched = new Set();

  async function ensureSearched(name) {
    const key = normalizeRsn(name);
    if (searched.has(key)) {
      return;
    }
    searched.add(key);
    for (const nc of await searchApprovedNameChanges(name)) {
      const into = normalizeRsn(nc.newName);
      if (!pool.has(into)) {
        pool.set(into, []);
      }
      pool.get(into).push(nc);
    }
  }

  let walkName;
  let floor;
  if (recent.length > 0) {
    walkName = recent[0].oldName;
    floor = new Date(recent[0].effectiveFrom);
  } else {
    walkName = username;
    floor = new Date();
  }

  const renamesInto = (name) =>
    (pool.get(normalizeRsn(name)) ?? []).filter(
      (nc) => new Date(nc.resolvedAt).getTime() < floor.getTime(),
    );

  const prefix = [];
  while (true) {
    // A search on a hub name populates the pool for every name it touches, so
    // only search when the pool cannot already answer for the walked name.
    let before = renamesInto(walkName);
    if (before.length === 0 && !searched.has(normalizeRsn(walkName))) {
      onProgress(`recovering older history across records ("${walkName}")`);
      await ensureSearched(walkName);
      before = renamesInto(walkName);
    }
    if (before.length === 0) {
      break;
    }
    // The most recent rename into the walked name before the running floor.
    const pred = before.reduce((a, b) =>
      new Date(a.resolvedAt) > new Date(b.resolvedAt) ? a : b,
    );
    prefix.unshift(toTransition(pred));
    walkName = pred.oldName;
    floor = new Date(pred.resolvedAt);
  }

  return [...prefix, ...recent];
}

function adminSecretFile() {
  const configHome =
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  return path.join(configHome, 'blert', 'admin-secret');
}

// Resolves the admin secret from `$BLERT_ADMIN_SECRET`, falling back to the
// contents of the `admin-secret` config file. Returns `null` if neither is set.
function readAdminSecret() {
  const fromEnv = process.env.BLERT_ADMIN_SECRET;
  if (fromEnv) {
    return fromEnv;
  }

  const file = adminSecretFile();
  try {
    const secret = fs.readFileSync(file, 'utf8').trim();
    return secret.length > 0 ? secret : null;
  } catch (e) {
    if (e.code === 'ENOENT') {
      return null;
    }
    fail(`could not read ${file}: ${e.message}`);
  }
}

async function submitChain(base, chain, apply) {
  const secret = readAdminSecret();
  if (secret === null) {
    fail(
      'no admin secret: set $BLERT_ADMIN_SECRET or write it to ' +
        adminSecretFile(),
    );
  }

  const url = `${base.replace(/\/$/, '')}/api/admin/historic-name-changes`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ chain, dryRun: !apply }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function fmtDate(value) {
  return new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function printPlan(plan) {
  const { target, contributions, sources } = plan;

  const evicted = plan.evictedChallenges ?? 0;
  const movedIn = target.challengesAfter - target.challengesBefore + evicted;

  console.log('Migration plan (dry run):');
  if (plan.unownedApiKeys > 0) {
    console.log(
      `  BLOCKED (apply will fail): target holds ${plan.unownedApiKeys} ` +
        'unowned API key(s)',
    );
  }
  console.log(`  Target: ${target.name}${target.isNew ? ' (new player)' : ''}`);
  console.log(
    `    challenges: ${target.challengesBefore} -> ${target.challengesAfter}`,
  );
  if (movedIn > 0 || evicted > 0) {
    const parts = [];
    if (movedIn > 0) {
      parts.push(`+${movedIn} moved in`);
    }
    if (evicted > 0) {
      parts.push(`-${evicted} evicted to a zombie`);
    }
    console.log(`      (${parts.join(', ')})`);
  }
  if (target.pbRecomputedFrom !== null) {
    console.log(`    PBs recomputed from: ${fmtDate(target.pbRecomputedFrom)}`);
  }

  if (contributions.length > 0) {
    console.log('  Contributions:');
    for (const c of contributions) {
      console.log(
        `    ${c.sourceName} as "${c.asName}" ` +
          `[${fmtDate(c.span.from)} .. ${fmtDate(c.span.to)}]: ` +
          `${c.challenges} challenge(s), ${c.stats} stat row(s), ${c.apiKeys} API key(s)`,
      );
    }
  } else {
    console.log('  Contributions: none (no existing data to migrate)');
  }

  if (sources.length > 0) {
    console.log('  Source records:');
    for (const s of sources) {
      if (s.outcome === 'deleted') {
        console.log(`    ${s.name}: deleted (fully absorbed by target)`);
      } else {
        console.log(
          `    ${s.name}: kept, PBs recomputed from ${fmtDate(s.pbRecomputedFrom)}`,
        );
      }
    }
  }

  const superseded = plan.supersededLiveRows ?? [];
  if (superseded.length > 0) {
    const reclaimed = superseded.filter((r) => r.reclaimed).length;
    console.log(
      `  Live duplicates hidden: ${superseded.length}` +
        (reclaimed > 0 ? ` (${reclaimed} reclaimed from other records)` : ''),
    );
    for (const r of superseded) {
      console.log(
        `    ${fmtDate(r.date)}  ${r.oldName} -> ${r.newName}  ` +
          `on ${r.currentOwner}${r.reclaimed ? ' (reclaim)' : ''}`,
      );
    }
  }
}

function startSpinner(initialLabel) {
  let label = initialLabel;
  if (!process.stderr.isTTY) {
    return { update: (next) => (label = next), stop: () => {} };
  }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const timer = setInterval(() => {
    process.stderr.write(`\r\x1b[K${frames[i++ % frames.length]} ${label}`);
  }, 80);
  return {
    update: (next) => (label = next),
    stop: () => {
      clearInterval(timer);
      process.stderr.write('\r\x1b[K');
    },
  };
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.username === undefined) {
    fail(
      'usage: BLERT_ADMIN_SECRET=... node tools/historic-name-changes.cjs ' +
        '<username> [--apply] [--base <url>] [--json]',
      2,
    );
  }

  let chain;
  const spinner = startSpinner('fetching name history');
  try {
    chain = await buildChain(opts.username, (msg) => spinner.update(msg));
  } catch (e) {
    spinner.stop();
    const message = e instanceof Error ? e.message : String(e);
    if (e && e.statusCode === 404) {
      fail(`player "${opts.username}" not found on Wise Old Man`);
    }
    if (e && e.statusCode === 429) {
      fail('rate limited by Wise Old Man; wait a minute and retry');
    }
    fail(`Wise Old Man lookup failed: ${message}`);
  }
  spinner.stop();

  if (chain.length === 0) {
    console.log(`No approved name changes found for "${opts.username}".`);
    return;
  }

  if (!opts.json) {
    console.log(
      `Name-change chain for "${opts.username}" ` +
        `(${chain.length} transition${chain.length === 1 ? '' : 's'}):`,
    );
    for (const t of chain) {
      console.log(
        `  ${fmtDate(t.effectiveFrom)}  ${t.oldName} -> ${t.newName}`,
      );
    }
    console.log();
  }

  const { status, body } = await submitChain(opts.base, chain, opts.apply);

  if (opts.json) {
    console.log(JSON.stringify(body, null, 2));
    process.exitCode = status === 200 ? 0 : 1;
    return;
  }

  if (status !== 200) {
    const error = body?.error ?? `HTTP ${status}`;
    fail(`request failed: ${ERROR_MESSAGES[error] ?? error}`);
  }

  if (opts.apply) {
    console.log(`Submitted historic name change sequence ${body.sequenceId}.`);
    return;
  }

  printPlan(body.plan);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
