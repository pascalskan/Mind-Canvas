/**
 * Integration test: GET /api/map disk-cache fallback
 *
 * Verifies that when the database is unreachable at cold-start, the server
 * serves data from `map-cache.json` instead of returning null.
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
// Any query attempt will time out / refuse-connection immediately.
// ---------------------------------------------------------------------------
process.env['DATABASE_URL'] = 'postgresql://test:test@127.0.0.1:1/test';
// Shorten pg connect timeout so the test doesn't hang for 30 s.
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

// ---------------------------------------------------------------------------
// Clean up the cache file after all tests, whether they pass or fail.
// ---------------------------------------------------------------------------
after(() => {
  try { fs.unlinkSync(CACHE_FILE); } catch { /* already absent — fine */ }
});

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

await test('GET /api/map returns disk-cached data when the database is down', async () => {
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
