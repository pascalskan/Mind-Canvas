/**
 * Unit tests for the mind-canvas persistence layer (saveBubbles / loadBubbles).
 *
 * Three scenarios required by the task:
 *   1. Round-trip: saveBubbles → loadBubbles restores the exact bubble tree.
 *   2. Legacy migration: a version-1 uncompressed save is accepted by loadBubbles.
 *   3. Corrupt data: a garbled compressed string falls back to INITIAL_BUBBLES
 *      without throwing.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import LZString from 'lz-string';
import {
  saveBubbles,
  loadBubbles,
  clearBubbles,
  STORAGE_KEY,
  STORAGE_VERSION,
  type BubbleData,
} from './persistence';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_BUBBLES: BubbleData[] = [
  { id: 'b0', depth: 0, label: 'Root A', x: -620, y: 0,   color: 'hsl(250,60%,65%)' },
  { id: 'b1', depth: 1, label: 'Child 1', x: -454, y: 0,  color: 'hsl(250,60%,65%)', parentId: 'b0', angle: 0, radial: 1 },
  { id: 'b2', depth: 1, label: 'Child 2', x: -454, y: 166, color: 'hsl(250,60%,65%)', parentId: 'b0', scale: 1.2 },
];

const FALLBACK_BUBBLES: BubbleData[] = [
  { id: 'fallback', depth: 0, label: 'Fallback', x: 0, y: 0, color: 'hsl(0,0%,50%)' },
];

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('saveBubbles / loadBubbles round-trip (version 2 compressed)', () => {
  it('restores the exact bubble array after a save', () => {
    const result = saveBubbles(SAMPLE_BUBBLES);

    expect(result.ok).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);

    const loaded = loadBubbles(FALLBACK_BUBBLES);

    expect(loaded).toEqual(SAMPLE_BUBBLES);
  });

  it('preserves optional fields (angle, radial, scale, parentId)', () => {
    saveBubbles(SAMPLE_BUBBLES);
    const loaded = loadBubbles(FALLBACK_BUBBLES);

    const child1 = loaded.find(b => b.id === 'b1');
    expect(child1?.parentId).toBe('b0');
    expect(child1?.angle).toBe(0);
    expect(child1?.radial).toBe(1);

    const child2 = loaded.find(b => b.id === 'b2');
    expect(child2?.scale).toBe(1.2);
  });

  it('returns { ok: true } and a positive byte count', () => {
    const { ok, bytes } = saveBubbles(SAMPLE_BUBBLES);
    expect(ok).toBe(true);
    expect(bytes).toBeGreaterThan(0);
  });

  it('returns initialBubbles when localStorage is empty', () => {
    const loaded = loadBubbles(FALLBACK_BUBBLES);
    expect(loaded).toBe(FALLBACK_BUBBLES);
  });
});

describe('legacy version-1 migration (uncompressed JSON)', () => {
  it('accepts a version-1 payload stored as plain JSON', () => {
    // Simulate what was stored by the old uncompressed save path.
    const legacyState = { version: 1, bubbles: SAMPLE_BUBBLES };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyState));

    const loaded = loadBubbles(FALLBACK_BUBBLES);

    // Should return the saved bubbles, NOT the fallback.
    expect(loaded).toEqual(SAMPLE_BUBBLES);
  });

  it('returns initialBubbles for an unrecognised version number', () => {
    const unknownState = { version: 99, bubbles: SAMPLE_BUBBLES };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unknownState));

    const loaded = loadBubbles(FALLBACK_BUBBLES);

    expect(loaded).toBe(FALLBACK_BUBBLES);
  });

  it('returns initialBubbles when the bubbles array is empty', () => {
    const emptyState = JSON.stringify({ version: 1, bubbles: [] });
    localStorage.setItem(STORAGE_KEY, emptyState);

    const loaded = loadBubbles(FALLBACK_BUBBLES);

    expect(loaded).toBe(FALLBACK_BUBBLES);
  });
});

describe('corrupt / truncated compressed data', () => {
  it('returns initialBubbles when the stored string is garbage', () => {
    localStorage.setItem(STORAGE_KEY, '!!!not-valid-lzstring-or-json!!!');

    const loaded = loadBubbles(FALLBACK_BUBBLES);

    expect(loaded).toBe(FALLBACK_BUBBLES);
  });

  it('does not throw when the compressed payload is truncated', () => {
    // Take a valid compressed save and cut it in half.
    saveBubbles(SAMPLE_BUBBLES);
    const raw = localStorage.getItem(STORAGE_KEY)!;
    localStorage.setItem(STORAGE_KEY, raw.slice(0, Math.floor(raw.length / 2)));

    expect(() => loadBubbles(FALLBACK_BUBBLES)).not.toThrow();
  });

  it('returns initialBubbles when the compressed payload is truncated', () => {
    saveBubbles(SAMPLE_BUBBLES);
    const raw = localStorage.getItem(STORAGE_KEY)!;
    localStorage.setItem(STORAGE_KEY, raw.slice(0, Math.floor(raw.length / 2)));

    const loaded = loadBubbles(FALLBACK_BUBBLES);

    expect(loaded).toBe(FALLBACK_BUBBLES);
  });

  it('returns initialBubbles for a valid lz-string that decompresses to invalid JSON', () => {
    // Compress something that is not valid StoredState JSON.
    const badJson = LZString.compress('{"this_is":"not a StoredState"}');
    localStorage.setItem(STORAGE_KEY, badJson);

    // JSON.parse will succeed but version check will fail → fallback.
    const loaded = loadBubbles(FALLBACK_BUBBLES);

    expect(loaded).toBe(FALLBACK_BUBBLES);
  });
});

describe('clearBubbles', () => {
  it('removes the stored key so the next load returns initialBubbles', () => {
    saveBubbles(SAMPLE_BUBBLES);
    clearBubbles();

    const loaded = loadBubbles(FALLBACK_BUBBLES);

    expect(loaded).toBe(FALLBACK_BUBBLES);
  });
});
