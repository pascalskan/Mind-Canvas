import { Router, type IRouter, type RequestHandler } from 'express';
import { db, mindCanvasMapTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { logger } from '../lib/logger';
import { validateMapPayload } from '../lib/mapPayload';

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Auth
//
// /api/map is otherwise unauthenticated with open CORS and a single global
// row (id=1) — anyone who can reach this deployment can read and overwrite
// every map on it. Setting MAP_API_TOKEN requires a matching
// `Authorization: Bearer <token>` header on every /api/map request.
//
// Off by default: with no token configured, behavior is unchanged from
// before this existed (a startup warning is logged so the gap is visible
// rather than silently assumed away). This is a shared secret, not a login
// system — there is no per-user auth anywhere in this app, and both clients
// are static bundles, so the token is only ever a deterrent against someone
// stumbling onto the deployed URL, not a defense against someone who already
// has legitimate access to run the app (the token ships in their bundle same
// as it would for anyone else). See M10 in the audit for the full reasoning.
// ---------------------------------------------------------------------------

const MAP_API_TOKEN = process.env['MAP_API_TOKEN'];

if (!MAP_API_TOKEN) {
  logger.warn(
    '/api/map: MAP_API_TOKEN is not set — every client that can reach this ' +
    'server can read and overwrite the shared map with no credentials. Set ' +
    'MAP_API_TOKEN (and the matching VITE_MAP_API_TOKEN / ' +
    'EXPO_PUBLIC_MAP_API_TOKEN on each client) to require one.',
  );
}

const requireMapToken: RequestHandler = (req, res, next) => {
  if (!MAP_API_TOKEN) { next(); return; } // auth disabled — unchanged behavior
  const header = req.headers.authorization;
  const provided = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (provided !== MAP_API_TOKEN) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  next();
};

// ---------------------------------------------------------------------------
// Disk cache
//
// A local JSON file that survives server restarts. Written on every successful
// DB read or write so the server can serve something sensible when Postgres is
// unreachable at cold start.
// ---------------------------------------------------------------------------

const DISK_CACHE_PATH = path.resolve(process.cwd(), 'map-cache.json');

function readDiskCache(): unknown | null {
  try {
    const raw = fs.readFileSync(DISK_CACHE_PATH, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeDiskCache(data: unknown): void {
  const tmp = `${DISK_CACHE_PATH}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, DISK_CACHE_PATH);
  } catch (err) {
    console.error('map-cache: failed to write disk cache:', err);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// Tracks the DB row's updated_at as of the last time GET wrote it to disk, so
// repeated polling (both clients poll /api/map every 30s) doesn't rewrite the
// same bytes to disk on every request. `updated_at` only changes when a real
// write commits, so it's a cheap, authoritative "has anything changed" check —
// cheaper than diffing the payload itself.
//
// The PUT path's own writeDiskCache call is intentionally NOT gated by this:
// it fires optimistically before the DB write is even attempted, specifically
// so a crash before commit still leaves something on disk — a one-time write
// per real edit, not the per-poll waste this addresses.
let lastGetDiskCacheAt: number | null = null;

function writeDiskCacheIfChanged(data: unknown, updatedAt: Date | null): void {
  const t = updatedAt?.getTime() ?? null;
  if (t !== null && t === lastGetDiskCacheAt) return;
  writeDiskCache(data);
  lastGetDiskCacheAt = t;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Monotonically increasing counter. Every PUT claims the next value before
 * doing any async work, so generation numbers strictly reflect arrival order.
 */
let writeGeneration = 0;

/**
 * The highest generation successfully committed to the database.
 * Writes whose generation is strictly below this are skipped in the queue.
 */
let committedGeneration = -1;

/**
 * The newest data the server is aware of (in-flight, committed, or optimistic).
 * Set on every PUT immediately (before the DB write) and on successful GET
 * when our local state is fully committed. Returned by GET when the database
 * is unreachable or when a newer local write hasn't been committed yet.
 */
let latestKnown: { gen: number; data: unknown } | null = null;

const IMMEDIATE_RETRY_DELAY_MS = 250;
const BACKGROUND_RETRY_INTERVAL_MS = 5_000;

// ---------------------------------------------------------------------------
// Serial write queue
//
// ALL database writes — including background retries — go through writeChain.
// This guarantees writes execute one at a time in enqueue order, so an older
// retry can never overwrite a newer committed value.
// ---------------------------------------------------------------------------
let writeChain: Promise<void> = Promise.resolve();

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function upsertMap(data: unknown): Promise<void> {
  await db
    .insert(mindCanvasMapTable)
    .values({ id: 1, data })
    .onConflictDoUpdate({
      target: mindCanvasMapTable.id,
      set: { data, updatedAt: new Date() },
    });
}

/**
 * Enqueue a write for the given generation into the serial queue.
 *
 * Resolves with null on success (or when the write is skipped because a newer
 * generation already committed). Resolves with an Error if both in-slot
 * attempts fail — never rejects, so callers don't need a catch.
 */
function enqueueWrite(gen: number, data: unknown): Promise<null | Error> {
  return new Promise<null | Error>((resolve) => {
    writeChain = writeChain
      .then(async () => {
        // A newer generation committed while we were waiting in the queue.
        if (gen < committedGeneration) {
          console.info(
            `PUT /api/map gen ${gen} skipped — gen ${committedGeneration} already committed.`,
          );
          resolve(null);
          return;
        }

        // Attempt 1
        try {
          await upsertMap(data);
          committedGeneration = gen;
          resolve(null);
          return;
        } catch (firstErr) {
          console.error(
            `PUT /api/map gen ${gen} attempt 1 failed, retrying in ${IMMEDIATE_RETRY_DELAY_MS}ms:`,
            firstErr,
          );
        }

        await delay(IMMEDIATE_RETRY_DELAY_MS);

        // Re-check after the delay — another write may have committed.
        if (gen < committedGeneration) {
          console.info(
            `PUT /api/map gen ${gen} skipped after delay — gen ${committedGeneration} already committed.`,
          );
          resolve(null);
          return;
        }

        // Attempt 2
        try {
          await upsertMap(data);
          committedGeneration = gen;
          resolve(null);
        } catch (secondErr) {
          console.error(
            `PUT /api/map gen ${gen} attempt 2 failed, queuing for background retry:`,
            secondErr,
          );
          resolve(secondErr instanceof Error ? secondErr : new Error(String(secondErr)));
        }
      })
      // Keep writeChain alive if something unexpected escapes the inner try/catch.
      .catch((unexpected) => {
        console.error('PUT /api/map unexpected queue error:', unexpected);
        resolve(unexpected instanceof Error ? unexpected : new Error(String(unexpected)));
      });
  });
}

// ---------------------------------------------------------------------------
// Background retry loop
//
// Routes retries through enqueueWrite so they are serialized with all other
// writes. The generation check inside enqueueWrite ensures an old retry is
// skipped when a newer write has already committed.
// ---------------------------------------------------------------------------
setInterval(() => {
  // Capture the latest known data that hasn't been committed yet (if any).
  if (latestKnown === null || latestKnown.gen <= committedGeneration) return;

  const { gen, data } = latestKnown;
  console.info(`Write-behind: re-queuing gen ${gen} for background retry.`);

  enqueueWrite(gen, data)
    .then((err) => {
      if (err === null) {
        console.info(`Write-behind retry succeeded (gen ${gen}): map data flushed to database.`);
      } else {
        console.error(
          `Write-behind retry failed (gen ${gen}), will try again in ${BACKGROUND_RETRY_INTERVAL_MS}ms:`,
          err.message,
        );
      }
    })
    .catch(() => {
      // enqueueWrite always resolves; this branch is unreachable but kept for safety.
    });
}, BACKGROUND_RETRY_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/map — returns { version, bubbles } or null if nothing saved yet.
 *
 * If our in-process state is newer than what has been committed (i.e. an
 * in-flight or failed write is pending), we return latestKnown immediately
 * instead of hitting the database — the client's most recent save intent must
 * not be overwritten by a stale DB read. On a database error the last-known-
 * good value is served instead of null.
 */
router.get('/map', requireMapToken, async (_req, res) => {
  // Uncommitted local state is fresher than anything in the DB right now.
  if (latestKnown !== null && latestKnown.gen > committedGeneration) {
    res.json(latestKnown.data);
    return;
  }

  try {
    const rows = await db
      .select()
      .from(mindCanvasMapTable)
      .where(eq(mindCanvasMapTable.id, 1))
      .limit(1);

    if (rows.length === 0) {
      if (latestKnown === null) latestKnown = { gen: 0, data: null };
      res.json(null);
      return;
    }

    const dbData = rows[0].data;
    // Only update latestKnown from the DB when there is no newer uncommitted
    // local data (re-checked in case a concurrent PUT arrived after the guard).
    if (latestKnown === null || latestKnown.gen <= committedGeneration) {
      latestKnown = { gen: committedGeneration, data: dbData };
    }
    writeDiskCacheIfChanged(dbData, rows[0].updatedAt);
    res.json(dbData);
  } catch (err) {
    console.error('GET /api/map: database unreachable, serving cached value. Error:', err);
    // Fall back to in-memory cache, then disk cache.
    if (latestKnown !== null) {
      res.json(latestKnown.data);
    } else {
      const diskData = readDiskCache();
      if (diskData !== null) {
        console.info('GET /api/map: serving disk cache fallback.');
        latestKnown = { gen: 0, data: diskData };
      }
      res.json(diskData);
    }
  }
});

/**
 * PUT /api/map — saves { version, bubbles } to the database.
 *
 * The write is enqueued in a serial queue so concurrent PUTs never race in
 * the database. Each queue slot retries once (with a short pause). On failure
 * the data is kept as the latest known state and replayed by the background
 * retry loop, so no save is silently discarded.
 */
router.put('/map', requireMapToken, async (req, res) => {
  // Validate BEFORE claiming a generation or touching any cache. This row is
  // the single shared canvas for every device, so a bad body must not become
  // latestKnown, must not be written to the disk cache, and must not consume a
  // generation number that would then out-rank a good concurrent write.
  const parsed = validateMapPayload(req.body);
  if (!parsed.ok) {
    logger.warn(`PUT /api/map rejected: ${parsed.error}`);
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }

  const myGen = ++writeGeneration;

  // The SERVER decides when a save happened, overriding whatever the client
  // sent. Every device orders saves by comparing savedAt against its own last
  // seen value, and savedAt used to come from the saving device's clock — so
  // two devices whose clocks disagreed could never see each other's work. A
  // phone running a few minutes behind a laptop would publish saves that the
  // laptop read as OLDER than its own, and silently ignored: both sides report
  // themselves in sync while holding completely different canvases, with no
  // error anywhere. One clock removes the whole class of problem.
  const data = { ...parsed.value, savedAt: Date.now() };

  // Optimistically record this as the newest known data immediately so GET can
  // serve it if the DB becomes unreachable before the write completes.
  if (latestKnown === null || myGen > latestKnown.gen) {
    latestKnown = { gen: myGen, data };
  }

  // Persist to disk before touching the database so this data survives a
  // server restart even if the DB write never completes.
  writeDiskCache(data);

  const err = await enqueueWrite(myGen, data);
  if (err === null) {
    // Hand back the timestamp we assigned. The saving client has to adopt it
    // as its "last seen" value; if it kept its own clock's reading instead, the
    // very next poll would compare the server's savedAt against a different
    // number and conclude it was out of step with its own save.
    res.json({ ok: true, savedAt: data.savedAt });
  } else {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
