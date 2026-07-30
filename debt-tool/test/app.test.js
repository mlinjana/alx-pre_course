import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A throwaway database per run, and settings that keep the app out of the
// developer's real data. Set before anything imports config.js.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfg-debt-tool-test-'));
process.env.DATABASE_FILE = path.join(tmpDir, 'test.db');
process.env.APP_SECRET = 'test-secret-for-integration-tests-0123456789';
process.env.NODE_ENV = 'test';
process.env.BUREAU_ALLOW_MOCK = 'true';
process.env.COOKIE_SECURE = 'false';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { createClient } = await import('../src/services/clients.js');
const { recordConsent } = await import('../src/services/consent.js');
const { closeDb } = await import('../src/db/index.js');

let server;
let base;
let client;

before(async () => {
  const app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  createUser({
    email: 'consultant@mlinjana.co.za',
    fullName: 'Test Consultant',
    role: 'consultant',
    password: 'integration-test-password',
  });

  client = createClient({
    firstName: 'Integration',
    lastName: 'Subject',
    idNumber: '9202204720083',
  }, { actorId: 1 });
});

after(() => {
  server?.close();
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Minimal cookie-jar fetch, so a test can stay signed in across requests. */
function makeSession() {
  const jar = new Map();
  return {
    get cookieHeader() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    async fetch(pathname, options = {}) {
      const response = await fetch(`${base}${pathname}`, {
        redirect: 'manual',
        ...options,
        headers: { ...(options.headers || {}), cookie: this.cookieHeader },
      });
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const idx = pair.indexOf('=');
        jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
      return response;
    },
    csrf() {
      return decodeURIComponent(jar.get('mfg_csrf') ?? '');
    },
  };
}

async function signIn() {
  const session = makeSession();
  await session.fetch('/login');
  const response = await session.fetch('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      _csrf: session.csrf(),
      email: 'consultant@mlinjana.co.za',
      password: 'integration-test-password',
    }),
  });
  assert.equal(response.status, 302, 'sign-in should redirect');
  return session;
}

test('the client list is not readable without signing in', async () => {
  const response = await fetch(`${base}/clients`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^\/login/);
});

test('the API answers 401 rather than redirecting', async () => {
  const response = await fetch(`${base}/api/clients`);
  assert.equal(response.status, 401);
});

test('a wrong password does not sign anyone in', async () => {
  const session = makeSession();
  await session.fetch('/login');
  const response = await session.fetch('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      _csrf: session.csrf(), email: 'consultant@mlinjana.co.za', password: 'wrong',
    }),
  });
  assert.equal(response.status, 401);
});

test('the login form cannot be turned into an open redirect', async () => {
  // Otherwise it is a ready-made phishing page aimed at the staff who hold
  // client credit data.
  const session = makeSession();
  await session.fetch('/login');
  const response = await session.fetch('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      _csrf: session.csrf(),
      email: 'consultant@mlinjana.co.za',
      password: 'integration-test-password',
      next: '//evil.example.com/harvest',
    }),
  });
  assert.equal(response.headers.get('location'), '/clients');
});

test('a signed-in consultant can read a client file', async () => {
  const session = await signIn();
  const response = await session.fetch(`/clients/${client.id}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Integration Subject/);
});

test('a state-changing POST without a CSRF token is refused', async () => {
  const session = await signIn();
  const response = await session.fetch(`/clients/${client.id}/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ provider: 'mock' }),
  });
  assert.equal(response.status, 403);
});

test('the error page renders when the CSRF check rejects a request', async () => {
  // Regression: the shared header needs template locals that were being set
  // *after* the CSRF middleware, so a rejected request crashed while trying to
  // render its own error page.
  const session = await signIn();
  const response = await session.fetch(`/clients/${client.id}/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ provider: 'mock' }),
  });
  const html = await response.text();
  assert.match(html, /session expired|form was stale/i);
  assert.doesNotMatch(html, /ReferenceError|is not defined/);
});

test('a bureau enquiry is refused until consent is on file', async () => {
  const session = await signIn();
  const response = await session.fetch(`/clients/${client.id}/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: session.csrf(), provider: 'mock' }),
  });
  assert.equal(response.status, 403);
  assert.match(await response.text(), /No active consent/);
});

test('with consent on file the enquiry runs and the totals appear', async () => {
  const session = await signIn();
  recordConsent({ clientId: client.id, consentType: 'bureau_enquiry', method: 'written' });

  const response = await session.fetch(`/clients/${client.id}/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: session.csrf(), provider: 'mock' }),
  });
  assert.equal(response.status, 302);

  const api = await session.fetch(`/api/clients/${client.id}`);
  const body = await api.json();
  assert.ok(body.debt.totalOwedCents > 0, 'the pull should produce a balance');
  assert.ok(body.debt.accountCount > 0);
  assert.equal(body.snapshot.isSimulated, true, 'mock data must be badged as simulated');
});

test('the API never returns a full ID number', async () => {
  const session = await signIn();
  const response = await session.fetch(`/api/clients/${client.id}`);
  const text = await response.text();
  assert.ok(!text.includes('9202204720083'), 'the ID number must not leave the server');
  assert.match(text, /"idNumberLast4":"0083"/);
});

test('a multipart upload reaches the route instead of being refused by CSRF', async () => {
  // Regression: the CSRF check ran before multer parsed the body, so the token
  // in the upload form was invisible and every PDF import was rejected.
  const session = await signIn();
  const form = new FormData();
  form.set('_csrf', session.csrf());
  form.set('report', new Blob([Buffer.from('%PDF-1.4 not really a pdf')], { type: 'application/pdf' }), 'r.pdf');

  const response = await session.fetch(`/clients/${client.id}/import`, { method: 'POST', body: form });
  // 400 means it got past CSRF and into the parser, which then rejected the
  // rubbish file — which is the correct outcome for this input.
  assert.equal(response.status, 400);
  assert.match(await response.text(), /could not be read as a PDF/);
});

test('a multipart upload with a bad CSRF token is still refused', async () => {
  const session = await signIn();
  const form = new FormData();
  form.set('_csrf', 'not-the-real-token');
  form.set('report', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), 'r.pdf');

  const response = await session.fetch(`/clients/${client.id}/import`, { method: 'POST', body: form });
  assert.equal(response.status, 403);
});

test('an unknown page renders the error view, not a stack trace', async () => {
  const session = await signIn();
  const response = await session.fetch('/clients/999999');
  assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /at Object|node_modules/);
});

test('a consultant cannot reach the admin pages', async () => {
  const session = await signIn();
  const response = await session.fetch('/admin/users');
  assert.equal(response.status, 403);
});

test('responses carry the headers that keep credit data out of caches', async () => {
  const session = await signIn();
  const response = await session.fetch(`/clients/${client.id}`);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
});
