// ─── Persistence ──────────────────────────────────────────────────────────────
// Extracted so the save/load logic can be unit-tested without pulling in the
// full React component tree or the canvas layout engine.
//
// saveBubbles  — compresses with lz-string and writes to localStorage.
// loadBubbles  — decompresses, falls back to legacy uncompressed (version 1),
//               falls back to initialBubbles on any error or unknown version.

import LZString from 'lz-string';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * One note attached to one bubble.
 *
 * Notes belong to the bubble that holds them and to nothing else — they are
 * never inherited by a parent and never seen by a child. The panel only ever
 * shows the notes of the bubble currently focused, which is what makes a note
 * a property of a place on the canvas rather than of the whole map.
 */
export interface BubbleNote {
  id:        string;
  text:      string;
  /** Epoch ms. Ordering and the "added ..." line; never used for sync. */
  createdAt: number;
}

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
  /** Absent and empty mean the same thing; absent is what gets written. */
  notes?:    BubbleNote[];
}

/** Which client wrote a save — used only for prompt wording. */
export type SavedBy = 'web' | 'mobile';

export interface StoredState {
  version: number;
  bubbles: BubbleData[];
  /** User-chosen canvas name, edited in Settings. */
  name?: string;
  /**
   * Epoch ms of the last EXPLICIT "Save canvas". Absent on maps written
   * before saves became explicit, which reads as "no save yet" — so an
   * existing map never triggers a restore prompt until someone actually
   * saves. This timestamp is the sole basis for deciding whether another
   * device has newer work; it is never set by ordinary editing.
   */
  savedAt?: number;
  /** Platform that performed that save, for "saved on your phone" wording. */
  savedBy?: SavedBy;
}

/** The save metadata carried alongside the bubbles, without the bubbles. */
export interface SaveMeta {
  name?: string;
  savedAt?: number;
  savedBy?: SavedBy;
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
 *
 * This is the LOCAL draft autosave and still runs on every edit — losing
 * in-progress work to a crashed tab would be unacceptable. It is deliberately
 * separate from saving to the cloud, which is now only ever explicit.
 *
 * `meta` records the canvas name plus the cloud save this draft is derived
 * from, so a reload keeps knowing which remote save it has already seen and
 * does not re-prompt about one the user already dismissed.
 */
export function saveBubbles(bubbles: BubbleData[], meta?: SaveMeta): { ok: boolean; bytes: number } {
  try {
    const state: StoredState = { version: STORAGE_VERSION, bubbles, ...meta };
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
  return loadStoredState(initialBubbles).bubbles;
}

/**
 * Like loadBubbles, but also returns the stored save metadata (canvas name and
 * the cloud save this draft is based on). Used at startup to decide whether the
 * cloud holds a newer save worth prompting about.
 *
 * `hadStored` distinguishes "returned initialBubbles because nothing was
 * stored" (a genuinely fresh device, which should silently adopt whatever the
 * cloud has) from "returned initialBubbles because the stored data was
 * unusable" — the caller treats those differently.
 */
export function loadStoredState(
  initialBubbles: BubbleData[],
): { bubbles: BubbleData[]; meta: SaveMeta; hadStored: boolean } {
  const empty = { bubbles: initialBubbles, meta: {} as SaveMeta, hadStored: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;

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
    if (parsed.version !== STORAGE_VERSION && parsed.version !== 1) return empty;
    if (!Array.isArray(parsed.bubbles) || parsed.bubbles.length === 0) return empty;
    // Reject a draft that is not safe to do geometry with. A previously
    // poisoned session can leave non-finite coordinates here (they persist as
    // `null` through JSON), and reloading them would immediately re-break the
    // canvas — turning a one-off glitch into a crash on every load.
    if (!parsed.bubbles.every(isValidBubble) || !isValidBubbleGraph(parsed.bubbles)) return empty;

    return {
      bubbles: parsed.bubbles,
      meta: { name: parsed.name, savedAt: parsed.savedAt, savedBy: parsed.savedBy },
      hadStored: true,
    };
  } catch {
    return empty;
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
export function exportBubbles(bubbles: BubbleData[], meta?: SaveMeta): void {
  const state: StoredState = { version: STORAGE_VERSION, bubbles, ...meta };
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  // Name the file after the canvas when it has one, so a folder of exports is
  // readable at a glance. Falls back to the original dated name otherwise.
  const slug = meta?.name?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  a.download = `${slug || 'mind-canvas'}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * A number that is safe to do geometry with. `typeof x === 'number'` is NOT
 * sufficient: NaN and Infinity both pass it, and a single NaN coordinate is
 * catastrophic here. It propagates through the layout into rendered sizes and
 * positions, and — because JSON.stringify turns NaN into `null` — it reaches
 * the shared cloud map as a null coordinate, which every client then rejects
 * wholesale, silently killing sync for all devices. Reject it at the door.
 */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validates that an individual bubble object has all required fields with the
 * correct types. Returns true only when the object is a well-formed BubbleData.
 *
 * Exported so the cloud-fetch path (useBubbleState.ts) can run the same check
 * on /api/map responses that importBubbles already runs on uploaded files —
 * that endpoint is shared and unauthenticated (see audit finding M10), so its
 * payload deserves the same scrutiny as a file from an unknown source.
 */
export function isValidBubble(b: unknown): b is BubbleData {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  if (typeof o.id     !== 'string' || !o.id)     return false;
  if (typeof o.label  !== 'string')               return false;
  if (!isFiniteNumber(o.x))                       return false;
  if (!isFiniteNumber(o.y))                       return false;
  if (typeof o.color  !== 'string' || !o.color)   return false;
  if (!isFiniteNumber(o.depth) || (o.depth as number) < 0) return false;
  // Optional fields — must have the right type when present.
  if (o.parentId !== undefined && typeof o.parentId !== 'string') return false;
  if (o.angle    !== undefined && !isFiniteNumber(o.angle))       return false;
  if (o.radial   !== undefined && !isFiniteNumber(o.radial))      return false;
  if (o.scale    !== undefined && !isFiniteNumber(o.scale))      return false;
  if (!isValidNotes(o.notes))                                     return false;
  return true;
}

/**
 * Notes must survive the same round trip as everything else here: a malformed
 * notes array on ONE bubble makes every client reject the whole map, which
 * strands all of them on their own local drafts with no error to explain it.
 * So this is checked at the door on all three sides — both clients and the
 * server — exactly like the geometry fields above.
 */
function isValidNotes(v: unknown): boolean {
  if (v === undefined) return true;
  if (!Array.isArray(v)) return false;
  for (const n of v) {
    if (!n || typeof n !== 'object') return false;
    const o = n as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id)  return false;
    if (typeof o.text !== 'string')         return false;
    if (!isFiniteNumber(o.createdAt))       return false;
  }
  return true;
}

/**
 * Validates the bubble graph:
 *  - No duplicate IDs.
 *  - Every parentId references a known bubble.
 *  - No cyclic parent chains (prevents infinite loops in traversal).
 * Returns true when the graph is safe to load.
 */
export function isValidBubbleGraph(bubbles: BubbleData[]): boolean {
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

/** A validated import: the bubbles plus whatever name the file carried. */
export interface ImportedCanvas {
  bubbles: BubbleData[];
  name?: string;
}

/**
 * Reads and validates a JSON file previously exported by exportBubbles.
 * Returns the bubbles and the file's canvas name on success, or null if the
 * file is invalid. Checks: version, nonempty array, per-bubble schema, no
 * duplicate IDs, no orphan parentId references, no cyclic parent chains.
 * Never throws — all errors are caught and returned as null.
 *
 * The name is returned rather than dropped because exportBubbles writes it
 * into the file: an export/import round trip that silently lost the canvas
 * name made the two halves of the same feature disagree, and left the
 * imported map wearing the name of whatever was on screen before.
 * `savedAt`/`savedBy` are deliberately NOT carried over — a file is not a
 * cloud save, and adopting its timestamp would make this device believe it
 * had already seen a remote save it has not.
 */
export function importBubbles(file: File): Promise<ImportedCanvas | null> {
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
        resolve({
          bubbles: parsed.bubbles,
          name: typeof parsed.name === 'string' ? parsed.name : undefined,
        });
      } catch {
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}
