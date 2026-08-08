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
