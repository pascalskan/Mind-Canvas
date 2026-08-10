/**
 * Integration tests: GET /api/map and PUT /api/map resilience
 *
 * All test() calls are made synchronously at module load so node:test knows
 * the full test plan before any test starts running.  (Using top-level
 * `await test(...)` would only register the next test after the previous one
 * resolves, which races against --test-force-exit on quiet event loops.)
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// The disk cache path mirrors what map.ts computes: path.resolve(cwd, 'map-cache.json').
// When pnpm runs scripts, cwd is the package root (artifacts/api-server).
// ---------------------------------------------------------------------------
const CACHE_FILE = path.resolve(process.cwd(), 'map-cache.json');

// ---------------------------------------------------------------------------
// Point DATABASE_URL at an unreachable port BEFORE importing the app so that
// the pg.Pool created inside @workspace/db uses the bad connection string.
// Any query attempt will refuse-connection immediately.
// ---------------------------------------------------------------------------
process.env['DATABASE_URL'] = 'postgresql://test:test@127.0.0.1:1/test';
process.env['PGCONNECT_TIMEOUT'] = '2';

// Dynamic import — executed after the env vars above are visible to every
// module that will be loaded as part of this import chain.
const { default: app } = await import('../app.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startServer(): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function get(server: http.Server, urlPath: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.get(
      { hostname: '127.0.0.1', port: addr.port, path: urlPath },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: raw });
          }
        });
      },
    );
    req.on('error', reject);
  });
}

function put(
  server: http.Server,
  urlPath: string,
  payload: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: urlPath,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: raw });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Clean up the cache file after all tests, whether they pass or fail.
// ---------------------------------------------------------------------------
after(() => {
  try { fs.unlinkSync(CACHE_FILE); } catch { /* already absent — fine */ }
});

// ---------------------------------------------------------------------------
// Tests — registered synchronously so node:test sees the full plan up-front.
// ---------------------------------------------------------------------------

test('GET /api/map returns disk-cached data when the database is down', async () => {
  // 1. Pre-seed the disk cache with known data.
  const seed = {
    version: 1,
    bubbles: [
      { id: 'root', label: 'cold-start test', children: [] },
    ],
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(seed), 'utf8');

  // 2. Start the server.
  const server = await startServer();
  try {
    // 3. Hit GET /api/map — the db query will fail; the route must fall back.
    const { status, body } = await get(server, '/api/map');

    // 4. Assert 200 with the seeded payload (not null).
    assert.equal(status, 200, `Expected 200 but got ${status}`);
    assert.deepEqual(
      body,
      seed,
      'Response body should match the pre-seeded disk cache',
    );
  } finally {
    await closeServer(server);
  }
});

// ---------------------------------------------------------------------------
// Write-behind retry path
//
// The DB is still unreachable (same process.env set at the top of this file).
// Verifies that:
//   (a) PUT returns 500 after both in-slot attempts fail, AND
//   (b) a subsequent GET returns the submitted payload from latestKnown —
//       confirming the data is not silently discarded even though the DB write
//       failed.
// ---------------------------------------------------------------------------

test(
  'write-behind: PUT returns 500 and GET still serves submitted data when DB is unreachable',
  { timeout: 15_000 },
  async () => {
    // Use a payload distinct from the cold-start seed so we can be sure the
    // GET response comes from latestKnown set by PUT, not from the disk cache.
    // Must be a VALID map: PUT now rejects malformed bodies with 400 before
    // the write path runs at all, so a shape-only fixture would test nothing.
    const payload = {
      version: 2,
      bubbles: [{ id: 'root', label: 'write-behind test', x: 0, y: 0, color: '#aaa', depth: 0 }],
    };

    const server = await startServer();
    try {
      // 1. PUT while DB is down — both in-slot attempts fail → 500.
      const putResult = await put(server, '/api/map', payload);
      assert.equal(
        putResult.status,
        500,
        `PUT should return 500 but got ${putResult.status}`,
      );
      assert.equal(
        (putResult.body as Record<string, unknown>).ok,
        false,
        'PUT response body should have ok: false',
      );

      // 2. GET immediately after — DB still down, so the route falls back to
      //    latestKnown, which was set optimistically by PUT before the DB attempt.
      const getResult = await get(server, '/api/map');
      assert.equal(
        getResult.status,
        200,
        `GET should return 200 but got ${getResult.status}`,
      );
      assert.deepEqual(
        getResult.body,
        payload,
        'GET should return the exact payload submitted by the failed PUT',
      );
    } finally {
      await closeServer(server);
    }
  },
);

// ---------------------------------------------------------------------------
// PUT body validation
//
// /api/map holds ONE row shared by every device. An accepted bad write does
// not degrade a single client — it replaces everyone's canvas, and because
// both clients validate on the way in, they then silently ignore the shared
// map and strand themselves on local drafts with no error anywhere. So every
// case below must come back 400 and leave the stored map untouched.
//
// The DB is unreachable in this file, which is exactly the right condition:
// a rejected body must never reach latestKnown or the disk cache either, so
// asserting that GET still returns the LAST GOOD map afterwards proves the
// rejection happened before any state was touched.
// ---------------------------------------------------------------------------

const GOOD_BUBBLE = { id: 'root', label: 'valid', x: 0, y: 0, color: '#aaa', depth: 0 };

const REJECTED_BODIES: [name: string, body: unknown][] = [
  ['a non-object body',            [1, 2, 3]],
  ['a null body',                  null],
  ['an unknown version',           { version: 99, bubbles: [GOOD_BUBBLE] }],
  ['a missing bubbles array',      { version: 2 }],
  ['bubbles that is not an array', { version: 2, bubbles: 'nope' }],
  // Every client reads an empty array as "nothing saved" and ignores it, so
  // storing one would wipe the shared map while reporting success.
  ['an empty bubbles array',       { version: 2, bubbles: [] }],
  ['a bubble missing required fields', { version: 2, bubbles: [{ id: 'x', label: 'no coords' }] }],
  // JSON.stringify turns NaN into null — this is the exact shape a poisoned
  // client sends, and the one that silently killed sync for every device.
  ['a null coordinate (how NaN arrives over the wire)',
    { version: 2, bubbles: [{ ...GOOD_BUBBLE, x: null }] }],
  ['a duplicate bubble id', {
    version: 2,
    bubbles: [GOOD_BUBBLE, { ...GOOD_BUBBLE, label: 'clash' }],
  }],
  ['an orphaned parentId', {
    version: 2,
    bubbles: [{ ...GOOD_BUBBLE, id: 'kid', parentId: 'ghost' }],
  }],
  // A cycle hangs the clients' `while (cur?.parentId)` breadcrumb walk.
  ['a parent cycle', {
    version: 2,
    bubbles: [
      { ...GOOD_BUBBLE, id: 'a', parentId: 'b' },
      { ...GOOD_BUBBLE, id: 'b', parentId: 'a' },
    ],
  }],
  ['a non-numeric savedAt', {
    version: 2, bubbles: [GOOD_BUBBLE], savedAt: 'yesterday',
  }],
  ['an unrecognised savedBy', {
    version: 2, bubbles: [GOOD_BUBBLE], savedBy: 'desktop',
  }],
  ['a non-string name', {
    version: 2, bubbles: [GOOD_BUBBLE], name: { first: 'nope' },
  }],
];

test('PUT /api/map rejects malformed bodies with 400 and preserves the stored map', async () => {
  const server = await startServer();
  try {
    // Establish a known-good map first. The DB is down, so this returns 500 —
    // but latestKnown/disk cache now hold it, which is what GET falls back to
    // and therefore what a bad write would have to clobber to do damage.
    const good = {
      version: 2,
      bubbles: [{ ...GOOD_BUBBLE, label: 'the good map' }],
      name: 'Keep me',
      savedAt: 1_700_000_000_000,
      savedBy: 'web',
    };
    await put(server, '/api/map', good);

    for (const [name, body] of REJECTED_BODIES) {
      const res = await put(server, '/api/map', body);
      assert.equal(res.status, 400, `${name}: expected 400 but got ${res.status}`);
      const resBody = res.body as Record<string, unknown>;
      assert.equal(resBody['ok'], false, `${name}: body should have ok: false`);
      assert.equal(
        typeof resBody['error'], 'string',
        `${name}: response must explain WHY, so a client can tell a bad request from a broken server`,
      );

      const after = await get(server, '/api/map');
      assert.deepEqual(
        after.body, good,
        `${name}: the stored map must be untouched by a rejected write`,
      );
    }
  } finally {
    await closeServer(server);
  }
});

test('PUT /api/map accepts a well-formed body and strips unknown top-level keys', async () => {
  const server = await startServer();
  try {
    await put(server, '/api/map', {
      version: 2,
      bubbles: [
        { ...GOOD_BUBBLE, id: 'p' },
        { id: 'c', parentId: 'p', label: 'child', x: 10, y: 20, color: '#bbb', depth: 1,
          angle: 1.5, radial: 0.5, scale: 1.2 },
      ],
      name: 'Accepted',
      savedAt: 1_700_000_000_001,
      savedBy: 'mobile',
      // Not part of the contract — must not be persisted into the shared row.
      injected: 'should not survive',
    });

    // DB is down, so this is served from latestKnown — i.e. exactly what the
    // route decided to store.
    const { body } = await get(server, '/api/map');
    const stored = body as Record<string, unknown>;
    assert.equal(stored['name'], 'Accepted');
    assert.equal(stored['savedBy'], 'mobile');
    assert.equal(stored['savedAt'], 1_700_000_000_001);
    assert.equal((stored['bubbles'] as unknown[]).length, 2);
    assert.equal(
      'injected' in stored, false,
      'unknown keys must not be written into the shared map row',
    );
    // Optional per-bubble fields must survive intact — they are the layout.
    const child = (stored['bubbles'] as Record<string, unknown>[])[1];
    assert.equal(child['angle'], 1.5);
    assert.equal(child['radial'], 0.5);
    assert.equal(child['scale'], 1.2);
  } finally {
    await closeServer(server);
  }
});
