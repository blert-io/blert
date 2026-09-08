import postgres from 'postgres';

const BASE_URL = process.env.BLERT_SMOKE_BASE_URL ?? 'http://localhost:3000';
const READY_TIMEOUT_MS = 120_000;
const READY_POLL_INTERVAL_MS = 500;
const PASSWORD = 'blert-smoke-password';

function uniqueName() {
  const stamp = Date.now().toString(36);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `smoke_${stamp}${suffix}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = 'no attempt made';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/metrics`);
      if (response.ok) {
        return;
      }
      lastError = `status ${response.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await sleep(READY_POLL_INTERVAL_MS);
  }

  throw new Error(
    `server at ${BASE_URL} not ready after ${READY_TIMEOUT_MS}ms: ${lastError}`,
  );
}

async function post(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE_URL,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.text() };
}

async function expectOk(label, path, body) {
  const result = await post(path, body);
  if (result.status !== 200) {
    throw new Error(
      `${label} failed: POST ${path} returned ${result.status}\n${result.body}`,
    );
  }
  return result;
}

async function main() {
  await waitForServer();

  const username = uniqueName();
  const email = `${username}@example.invalid`;

  try {
    await expectOk('registration', '/api/auth/sign-up/email', {
      email,
      password: PASSWORD,
      name: username,
      username,
    });

    await expectOk('sign-in', '/api/auth/sign-in/username', {
      username,
      password: PASSWORD,
    });

    console.log(`auth smoke passed for ${username}`);
  } finally {
    const uri = process.env.BLERT_DATABASE_URI;
    if (uri !== undefined) {
      const sql = postgres(uri);
      try {
        await sql`DELETE FROM users WHERE username = ${username}`;
      } finally {
        await sql.end();
      }
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
