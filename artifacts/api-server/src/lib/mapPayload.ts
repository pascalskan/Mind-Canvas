/**
 * Validation for the shared map payload.
 *
 * PUT /api/map used to write `req.body` straight through — whatever arrived
 * became the single canonical map for every device. That is the one row in
 * this system with no undo: a bad write does not degrade one client, it
 * replaces everyone's canvas. Both clients already validate on the way IN
 * (they reject a malformed map and fall back to their local draft), which
 * means a poisoned row does not crash anything — it silently strands every
 * device on its own copy while the shared map stays broken, with no error
 * anywhere to explain why saving from the other device stopped working.
 *
 * So the rules here deliberately mirror the clients' own checks rather than
 * being looser: anything the clients would refuse to load is refused at the
 * door with a 400, while the last good map stays intact.
 */

/** Mirrors BubbleNote on both clients. */
export interface BubbleNote {
  id: string;
  text: string;
  createdAt: number;
  /** Offset from the owning bubble's centre, once a note has been dragged. */
  dx?: number;
  dy?: number;
}

/** Mirrors BubbleData on both clients. */
export interface Bubble {
  id: string;
  parentId?: string;
  label: string;
  x: number;
  y: number;
  color: string;
  depth: number;
  angle?: number;
  radial?: number;
  scale?: number;
  notes?: BubbleNote[];
}

export interface MapPayload {
  version: number;
  bubbles: Bubble[];
  name?: string;
  savedAt?: number;
  savedBy?: 'web' | 'mobile';
}

/**
 * Upper bound on bubbles in one map. The clients render every bubble in a
 * single tree and re-run collision resolution over all of them, so a payload
 * far beyond any real canvas is a denial of service against the clients as
 * much as against this server. Generous enough that no genuine map hits it.
 */
export const MAX_BUBBLES = 10_000;

/** Matches the clients: NaN and Infinity both pass `typeof x === 'number'`. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isValidBubble(b: unknown): b is Bubble {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  if (typeof o['id'] !== 'string' || !o['id']) return false;
  if (typeof o['label'] !== 'string') return false;
  if (!isFiniteNumber(o['x'])) return false;
  if (!isFiniteNumber(o['y'])) return false;
  if (typeof o['color'] !== 'string' || !o['color']) return false;
  if (!isFiniteNumber(o['depth']) || o['depth'] < 0) return false;
  if (o['parentId'] !== undefined && typeof o['parentId'] !== 'string') return false;
  if (o['angle'] !== undefined && !isFiniteNumber(o['angle'])) return false;
  if (o['radial'] !== undefined && !isFiniteNumber(o['radial'])) return false;
  if (o['scale'] !== undefined && !isFiniteNumber(o['scale'])) return false;
  if (!isValidNotes(o['notes'])) return false;
  return true;
}

/**
 * Same rule as both clients run on the way in. Letting a malformed notes array
 * into the shared row would make every device refuse the whole map on its next
 * load — the exact silent, map-wide breakage this file exists to prevent.
 */
function isValidNotes(v: unknown): boolean {
  if (v === undefined) return true;
  if (!Array.isArray(v)) return false;
  for (const n of v) {
    if (!n || typeof n !== 'object') return false;
    const o = n as Record<string, unknown>;
    if (typeof o['id'] !== 'string' || !o['id']) return false;
    if (typeof o['text'] !== 'string') return false;
    if (!isFiniteNumber(o['createdAt'])) return false;
    if (o['dx'] !== undefined && !isFiniteNumber(o['dx'])) return false;
    if (o['dy'] !== undefined && !isFiniteNumber(o['dy'])) return false;
  }
  return true;
}

/**
 * Duplicate ids, orphaned parents, and parent cycles. The cycle check is not
 * theoretical: both clients walk `while (cur?.parentId)` to build breadcrumbs
 * and relative layers, so a cycle in this row hangs the UI thread on every
 * device that loads it.
 */
function graphError(bubbles: Bubble[]): string | null {
  const ids = new Set<string>();
  for (const b of bubbles) {
    if (ids.has(b.id)) return `duplicate bubble id "${b.id}"`;
    ids.add(b.id);
  }
  for (const b of bubbles) {
    if (b.parentId !== undefined && !ids.has(b.parentId)) {
      return `bubble "${b.id}" references unknown parent "${b.parentId}"`;
    }
  }
  const byId = new Map(bubbles.map((b) => [b.id, b]));
  for (const start of bubbles) {
    const visited = new Set<string>();
    let cur: Bubble | undefined = start;
    while (cur?.parentId) {
      if (visited.has(cur.id)) return `parent chain from "${start.id}" forms a cycle`;
      visited.add(cur.id);
      cur = byId.get(cur.parentId);
    }
  }
  return null;
}

export type ValidationResult =
  | { ok: true; value: MapPayload }
  | { ok: false; error: string };

/**
 * Validates a PUT body. Returns a specific reason on failure — a client that
 * cannot save needs to know whether it sent something wrong or the server is
 * broken, and "400 with a reason" is the only way it can tell.
 */
export function validateMapPayload(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const o = body as Record<string, unknown>;

  // Version 1 (uncompressed legacy) and 2 (current) are both accepted, matching
  // what the clients are willing to read back.
  if (o['version'] !== 1 && o['version'] !== 2) {
    return { ok: false, error: 'version must be 1 or 2' };
  }

  if (!Array.isArray(o['bubbles'])) {
    return { ok: false, error: 'bubbles must be an array' };
  }
  const bubbles = o['bubbles'] as unknown[];

  // An empty map is rejected rather than stored. Every client treats an empty
  // bubbles array as "nothing saved" and ignores it, so accepting one would
  // destroy the shared map while every device reported success.
  if (bubbles.length === 0) {
    return { ok: false, error: 'bubbles must not be empty' };
  }
  if (bubbles.length > MAX_BUBBLES) {
    return { ok: false, error: `bubbles exceeds the maximum of ${MAX_BUBBLES}` };
  }

  for (let i = 0; i < bubbles.length; i++) {
    if (!isValidBubble(bubbles[i])) {
      return { ok: false, error: `bubbles[${i}] is not a valid bubble` };
    }
  }
  const valid = bubbles as Bubble[];

  const gErr = graphError(valid);
  if (gErr !== null) return { ok: false, error: gErr };

  // Optional metadata. Wrong types are rejected rather than dropped: `savedAt`
  // is what every device compares to decide whether a newer save exists, so a
  // bad value there breaks the prompt for everyone.
  if (o['name'] !== undefined && typeof o['name'] !== 'string') {
    return { ok: false, error: 'name must be a string' };
  }
  if (o['savedAt'] !== undefined && !isFiniteNumber(o['savedAt'])) {
    return { ok: false, error: 'savedAt must be a finite number' };
  }
  if (o['savedBy'] !== undefined && o['savedBy'] !== 'web' && o['savedBy'] !== 'mobile') {
    return { ok: false, error: 'savedBy must be "web" or "mobile"' };
  }

  // Rebuild rather than passing `body` through, so unknown top-level keys are
  // not persisted into the shared row.
  const value: MapPayload = { version: o['version'], bubbles: valid };
  if (typeof o['name'] === 'string') value.name = o['name'];
  if (isFiniteNumber(o['savedAt'])) value.savedAt = o['savedAt'];
  if (o['savedBy'] === 'web' || o['savedBy'] === 'mobile') value.savedBy = o['savedBy'];

  return { ok: true, value };
}
