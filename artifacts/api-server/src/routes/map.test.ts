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
    const payload = {
      version: 2,
      bubbles: [{ id: 'root', label: 'write-behind test', children: [] }],
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
