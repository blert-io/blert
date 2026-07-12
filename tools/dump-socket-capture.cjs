#!/usr/bin/env node
// Dumps a socket server's capture stream to NDJSON on stdout.
//
//   BLERT_REDIS_URI=redis://localhost:6379 \
//     node tools/dump-capture.cjs > capture.ndjson
//
// Options:
//   --url <uri>    Redis URI (default $BLERT_REDIS_URI or redis://localhost:6379).
//   --key <key>    Stream key (default capture:commands).
//   --batch <n>    XRANGE batch size (default 1000).
//   --trim         Delete the stream after a successful dump.

const { parseArgs } = require('node:util');
const { createClient } = require('redis');

// Keep in sync with socket-server/capture.ts.
const DEFAULT_KEY = 'capture:commands';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    key: { type: 'string' },
    batch: { type: 'string' },
    trim: { type: 'boolean' },
  },
});

const url =
  values.url ?? process.env.BLERT_REDIS_URI ?? 'redis://localhost:6379';
const key = values.key ?? DEFAULT_KEY;
const batch = Number.parseInt(values.batch ?? '1000', 10);
if (!Number.isInteger(batch) || batch < 1) {
  process.stderr.write('--batch must be a positive integer\n');
  process.exit(1);
}

async function main() {
  const client = createClient({ url });
  client.on('error', (err) => {
    process.stderr.write(`redis error: ${err.message}\n`);
  });
  await client.connect();

  let cursor = '-';
  let total = 0;
  for (;;) {
    const entries = await client.xRange(key, cursor, '+', { COUNT: batch });
    if (entries.length === 0) {
      break;
    }

    for (const { message } of entries) {
      // Each stream entry stores its CaptureRecord JSON in a `data` field.
      if (typeof message.data === 'string') {
        process.stdout.write(message.data + '\n');
        total += 1;
      }
    }

    // Resume strictly after the last id.
    cursor = `(${entries[entries.length - 1].id}`;
    if (entries.length < batch) {
      break;
    }
  }

  process.stderr.write(`dumped ${total} record(s) from ${key}\n`);

  if (values.trim && total > 0) {
    await client.del(key);
    process.stderr.write(`deleted ${key}\n`);
  }

  await client.quit();
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
