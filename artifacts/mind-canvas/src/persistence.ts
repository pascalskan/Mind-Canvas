// ─── Persistence ──────────────────────────────────────────────────────────────
// Extracted so the save/load logic can be unit-tested without pulling in the
// full React component tree or the canvas layout engine.
//
// saveBubbles  — compresses with lz-string and writes to localStorage.
// loadBubbles  — decompresses, falls back to legacy uncompressed (version 1),
//               falls back to initialBubbles on any error or unknown version.

import LZString from 'lz-string';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BubbleData {
  id:        string;
  parentId?: string;
  label:     string;
  x:         number;
  y:         number;
  color:     string;
  depth:     number;
  angle?:    number;
  radial?:   number;
  scale?:    number;
}

export interface StoredState {
  version: number;
  bubbles: BubbleData[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const STORAGE_KEY     = 'mind-canvas-bubbles';
export const STORAGE_VERSION = 2;

// localStorage quota is typically 5 MB (UTF-16 → 2 bytes per char).
// Warn when the compressed payload exceeds 80 % of that estimate.
export const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;
export const STORAGE_WARN_RATIO  = 0.8;

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Saves bubbles to localStorage using lz-string compression (version 2 format).
 * Returns { ok: true, bytes } on success, { ok: false, bytes: 0 } when the
 * storage is full or unavailable.
 */
export function saveBubbles(bubbles: BubbleData[]): { ok: boolean; bytes: number } {
  try {
    const state: StoredState = { version: STORAGE_VERSION, bubbles };
    const json = JSON.stringify(state);
    const compressed = LZString.compress(json);
    localStorage.setItem(STORAGE_KEY, compressed);
    // Each JS string character occupies 2 bytes in UTF-16 storage.
    return { ok: true, bytes: compressed.length * 2 };
  } catch {
    // Storage full or unavailable — caller decides how to surface this.
    return { ok: false, bytes: 0 };
  }
}

/**
 * Loads bubbles from localStorage.
 *
 * Priority:
 *  1. Decompressed version-2 payload (lz-string).
 *  2. Legacy version-1 uncompressed JSON (migration path).
 *  3. `initialBubbles` — used when nothing is stored, the version is
 *     unrecognised, the array is empty, or any error occurs.
 *
 * Never throws.
 */
export function loadBubbles(initialBubbles: BubbleData[]): BubbleData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialBubbles;

    // Try decompressing first (version 2+). If that yields nothing, fall back
    // to treating the stored value as plain JSON (version 1 legacy saves).
    let json: string | null = null;
    try {
      json = LZString.decompress(raw);
    } catch { /* decompression threw — treat as legacy */ }

    if (!json) {
      // Legacy uncompressed save — parse directly and migrate gracefully.
      json = raw;
    }

    const parsed: StoredState = JSON.parse(json);
    // Accept both the current version and the previous uncompressed version (1)
    // so a user who hasn't saved yet since the upgrade doesn't lose their data.
    if (parsed.version !== STORAGE_VERSION && parsed.version !== 1) return initialBubbles;
    if (!Array.isArray(parsed.bubbles) || parsed.bubbles.length === 0) return initialBubbles;
    return parsed.bubbles;
  } catch {
    return initialBubbles;
  }
}

/**
 * Removes the persisted mind-map state from localStorage.
 * Safe to call even when localStorage is unavailable.
 */
export function clearBubbles(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/**
 * Triggers a browser download of the current bubble tree as a JSON file.
 * The file format is identical to StoredState so it can be re-imported.
 */
export function exportBubbles(bubbles: BubbleData[]): void {
  const state: StoredState = { version: STORAGE_VERSION, bubbles };
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `mind-canvas-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Validates that an individual bubble object has all required fields with the
 * correct types. Returns true only when the object is a well-formed BubbleData.
 */
function isValidBubble(b: unknown): b is BubbleData {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  if (typeof o.id     !== 'string' || !o.id)     return false;
  if (typeof o.label  !== 'string')               return false;
  if (typeof o.x      !== 'number')               return false;
  if (typeof o.y      !== 'number')               return false;
  if (typeof o.color  !== 'string' || !o.color)   return false;
  if (typeof o.depth  !== 'number' || o.depth < 0 || !Number.isFinite(o.depth)) return false;
  // Optional fields — must have the right type when present.
  if (o.parentId !== undefined && typeof o.parentId !== 'string') return false;
  if (o.angle    !== undefined && typeof o.angle    !== 'number') return false;
  if (o.radial   !== undefined && typeof o.radial   !== 'number') return false;
  if (o.scale    !== undefined && typeof o.scale    !== 'number') return false;
  return true;
}

/**
 * Validates the bubble graph:
 *  - No duplicate IDs.
 *  - Every parentId references a known bubble.
 *  - No cyclic parent chains (prevents infinite loops in traversal).
 * Returns true when the graph is safe to load.
 */
function isValidBubbleGraph(bubbles: BubbleData[]): boolean {
  const ids = new Set<string>();
  for (const b of bubbles) {
    if (ids.has(b.id)) return false; // duplicate ID
    ids.add(b.id);
  }
  // All parentId references must point to known IDs.
  for (const b of bubbles) {
    if (b.parentId !== undefined && !ids.has(b.parentId)) return false;
  }
  // Cycle detection: walk each bubble's parent chain.
  const byId = new Map(bubbles.map(b => [b.id, b]));
  for (const start of bubbles) {
    const visited = new Set<string>();
    let cur: BubbleData | undefined = start;
    while (cur?.parentId) {
      if (visited.has(cur.id)) return false; // cycle detected
      visited.add(cur.id);
      cur = byId.get(cur.parentId);
    }
  }
  return true;
}

/**
 * Reads and validates a JSON file previously exported by exportBubbles.
 * Returns the parsed bubble array on success, or null if the file is invalid.
 * Checks: version, nonempty array, per-bubble schema, no duplicate IDs,
 * no orphan parentId references, no cyclic parent chains.
 * Never throws — all errors are caught and returned as null.
 */
export function importBubbles(file: File): Promise<BubbleData[] | null> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const parsed: StoredState = JSON.parse(text);
        if (
          (parsed.version !== STORAGE_VERSION && parsed.version !== 1) ||
          !Array.isArray(parsed.bubbles) ||
          parsed.bubbles.length === 0
        ) {
          resolve(null);
          return;
        }
        // Per-bubble schema validation.
        if (!parsed.bubbles.every(isValidBubble)) {
          resolve(null);
          return;
        }
        // Graph integrity check.
        if (!isValidBubbleGraph(parsed.bubbles)) {
          resolve(null);
          return;
        }
        resolve(parsed.bubbles);
      } catch {
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}
