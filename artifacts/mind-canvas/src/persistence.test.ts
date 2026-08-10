/**
 * Unit tests for the mind-canvas persistence layer (saveBubbles / loadBubbles).
 *
 * Three scenarios required by the task:
 *   1. Round-trip: saveBubbles → loadBubbles restores the exact bubble tree.
 *   2. Legacy migration: a version-1 uncompressed save is accepted by loadBubbles.
 *   3. Corrupt data: a garbled compressed string falls back to INITIAL_BUBBLES
 *      without throwing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import LZString from 'lz-string';
import {
  saveBubbles,
  loadBubbles,
  clearBubbles,
  exportBubbles,
  importBubbles,
  isValidBubble,
  STORAGE_KEY,
  STORAGE_VERSION,
  type BubbleData,
  type StoredState,
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

// ─── exportBubbles ────────────────────────────────────────────────────────────

describe('exportBubbles — download format', () => {
  it('triggers a download with the correct filename pattern', () => {
    // Stub out the DOM methods used by exportBubbles.
    const click = vi.fn();
    const revokeObjectURL = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:test-url');
    const appendChild  = vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);
    const removeChild  = vi.spyOn(document.body, 'removeChild').mockImplementation(() => document.body);
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    // Capture the <a> element created inside exportBubbles.
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(
      Object.assign(document.createElement('a'), { click }),
    );

    exportBubbles(SAMPLE_BUBBLES);

    expect(createElement).toHaveBeenCalledWith('a');
    // Filename should start with "mind-canvas-" and end in ".json".
    const anchor = createElement.mock.results[0].value as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^mind-canvas-\d{4}-\d{2}-\d{2}\.json$/);
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');

    createElement.mockRestore();
    appendChild.mockRestore();
    removeChild.mockRestore();
    vi.unstubAllGlobals();
  });

  it('produces a Blob whose text is valid StoredState JSON', () => {
    let capturedBlob: Blob | undefined;
    const createObjectURL = vi.fn((b: Blob) => { capturedBlob = b; return 'blob:x'; });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => document.body);
    const click = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue(
      Object.assign(document.createElement('a'), { click }),
    );

    exportBubbles(SAMPLE_BUBBLES);

    expect(capturedBlob).toBeDefined();
    expect(capturedBlob!.type).toBe('application/json');

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});

// ─── importBubbles ────────────────────────────────────────────────────────────

/** Creates a File whose content is a serialised StoredState. */
function makeImportFile(state: StoredState): File {
  return new File([JSON.stringify(state)], 'test.json', { type: 'application/json' });
}

describe('importBubbles — valid files', () => {
  it('resolves with the bubble array for a current-version export', async () => {
    const result = await importBubbles(makeImportFile({ version: STORAGE_VERSION, bubbles: SAMPLE_BUBBLES }));
    expect(result?.bubbles).toEqual(SAMPLE_BUBBLES);
  });

  it('accepts a version-1 file (legacy export)', async () => {
    const result = await importBubbles(makeImportFile({ version: 1, bubbles: SAMPLE_BUBBLES }));
    expect(result?.bubbles).toEqual(SAMPLE_BUBBLES);
  });

  it('preserves all optional fields (angle, radial, scale, parentId)', async () => {
    const result = await importBubbles(makeImportFile({ version: STORAGE_VERSION, bubbles: SAMPLE_BUBBLES }));
    const b1 = result?.bubbles.find(b => b.id === 'b1');
    expect(b1?.parentId).toBe('b0');
    expect(b1?.angle).toBe(0);
    expect(b1?.radial).toBe(1);
    const b2 = result?.bubbles.find(b => b.id === 'b2');
    expect(b2?.scale).toBe(1.2);
  });

  // The canvas name is half of the export feature: a file that carries a name
  // but imports without it silently renames the user's map.
  it('returns the canvas name stored in the file', async () => {
    const result = await importBubbles(makeImportFile({
      version: STORAGE_VERSION, bubbles: SAMPLE_BUBBLES, name: 'Product strategy',
    }));
    expect(result?.name).toBe('Product strategy');
  });

  it('returns undefined for the name when the file has none, so the caller can clear it', async () => {
    const result = await importBubbles(makeImportFile({ version: STORAGE_VERSION, bubbles: SAMPLE_BUBBLES }));
    expect(result?.name).toBeUndefined();
  });

  it('ignores a non-string name rather than adopting it', async () => {
    const result = await importBubbles(makeImportFile({
      version: STORAGE_VERSION, bubbles: SAMPLE_BUBBLES, name: 42 as unknown as string,
    }));
    expect(result?.bubbles).toEqual(SAMPLE_BUBBLES);
    expect(result?.name).toBeUndefined();
  });

  // savedAt/savedBy must NOT come back: adopting a file's timestamp would make
  // this device believe it had already seen a cloud save it has never seen,
  // suppressing the "new save available" prompt for real remote work.
  it('does not surface savedAt or savedBy from the file', async () => {
    const result = await importBubbles(makeImportFile({
      version: STORAGE_VERSION, bubbles: SAMPLE_BUBBLES, savedAt: 1_700_000_000_000, savedBy: 'mobile',
    }));
    expect(result).not.toHaveProperty('savedAt');
    expect(result).not.toHaveProperty('savedBy');
  });
});

describe('importBubbles — malformed files', () => {
  it('returns null for a non-JSON file', async () => {
    const file = new File(['not json at all!!!'], 'bad.json', { type: 'application/json' });
    expect(await importBubbles(file)).toBeNull();
  });

  it('returns null for an unrecognised version', async () => {
    const result = await importBubbles(makeImportFile({ version: 99, bubbles: SAMPLE_BUBBLES }));
    expect(result).toBeNull();
  });

  it('returns null for an empty bubbles array', async () => {
    const result = await importBubbles(makeImportFile({ version: STORAGE_VERSION, bubbles: [] }));
    expect(result).toBeNull();
  });

  it('returns null when a bubble is missing a required field (id)', async () => {
    const bad = [{ depth: 0, label: 'No ID', x: 0, y: 0, color: 'hsl(0,0%,50%)' }];
    const result = await importBubbles(makeImportFile({ version: STORAGE_VERSION, bubbles: bad as BubbleData[] }));
    expect(result).toBeNull();
  });

  it('returns null when a bubble has the wrong type for a required field (depth is a string)', async () => {
    const bad = [{ id: 'x1', depth: 'zero' as unknown as number, label: 'Bad', x: 0, y: 0, color: '#fff' }];
    const result = await importBubbles(makeImportFile({ version: STORAGE_VERSION, bubbles: bad as BubbleData[] }));
    expect(result).toBeNull();
  });

  it('returns null when two bubbles share the same id (duplicate ID)', async () => {
    const dupes: BubbleData[] = [
      { id: 'dup', depth: 0, label: 'A', x: 0, y: 0, color: '#aaa' },
      { id: 'dup', depth: 0, label: 'B', x: 1, y: 1, color: '#bbb' },
    ];
    const result = await importBubbles(makeImportFile({ version: STORAGE_VERSION, bubbles: dupes }));
    expect(result).toBeNull();
  });

  it('returns null when a parentId references a non-existent bubble (orphan ref)', async () => {
    const orphan: BubbleData[] = [
      { id: 'b0', depth: 0, label: 'Root', x: 0, y: 0, color: '#aaa' },
      { id: 'b1', depth: 1, label: 'Child', x: 1, y: 1, color: '#bbb', parentId: 'does-not-exist' },
    ];
    const result = await importBubbles(makeImportFile({ version: STORAGE_VERSION, bubbles: orphan }));
    expect(result).toBeNull();
  });

  it('returns null when the parent chain forms a cycle', async () => {
    // b0 → parent: b1, b1 → parent: b0  (cycle)
    const cyclic: BubbleData[] = [
      { id: 'b0', depth: 0, label: 'A', x: 0, y: 0, color: '#aaa', parentId: 'b1' },
      { id: 'b1', depth: 1, label: 'B', x: 1, y: 1, color: '#bbb', parentId: 'b0' },
    ];
    const result = await importBubbles(makeImportFile({ version: STORAGE_VERSION, bubbles: cyclic }));
    expect(result).toBeNull();
  });

  // A NaN cannot survive a File-based import test: JSON.stringify turns it
  // into `null`, so this only proves null coordinates are rejected — which is
  // still the exact shape a poisoned map arrives in over the wire, and is why
  // one bad device silently kills sync for every device.
  it('returns null when a coordinate arrived as null (how a NaN looks over the wire)', async () => {
    const overWire = [{ id: 'b0', depth: 0, label: 'Bad', x: null, y: 0, color: '#aaa' }];
    const result = await importBubbles(makeImportFile({ version: STORAGE_VERSION, bubbles: overWire as unknown as BubbleData[] }));
    expect(result).toBeNull();
  });
});

// isValidBubble is unit-tested directly rather than through importBubbles:
// a live NaN never survives the JSON boundary an import goes through, so an
// import-level test cannot distinguish `typeof x === 'number'` from
// `Number.isFinite(x)`. In-memory is where a real NaN actually appears —
// produced by the app's own arithmetic (a poisoned camera scale divides into
// drag positions) — and that is precisely the value that must be rejected
// before it is written to storage or pushed to the shared cloud map.
describe('isValidBubble — non-finite numbers (in-memory, no JSON boundary)', () => {
  const base: BubbleData = { id: 'b0', depth: 0, label: 'Base', x: 0, y: 0, color: '#aaa' };

  it('accepts a well-formed bubble', () => {
    expect(isValidBubble(base)).toBe(true);
  });

  it('accepts legitimately-present optional numeric fields', () => {
    expect(isValidBubble({ ...base, parentId: 'p', angle: 0, radial: 0.5, scale: 1.2 })).toBe(true);
  });

  it.each([
    ['x is NaN',       { x: NaN }],
    ['y is NaN',       { y: NaN }],
    ['x is Infinity',  { x: Infinity }],
    ['y is -Infinity', { y: -Infinity }],
    ['depth is NaN',   { depth: NaN }],
    ['scale is NaN',   { scale: NaN }],
    ['angle is NaN',   { angle: NaN }],
    ['radial is NaN',  { radial: NaN }],
  ])('rejects when %s', (_label, patch) => {
    expect(isValidBubble({ ...base, ...patch })).toBe(false);
  });
});

describe('exportBubbles → importBubbles round-trip', () => {
  it('a file exported with a name re-imports with both the bubbles and the name', async () => {
    let capturedBlob: Blob | undefined;
    const createObjectURL = vi.fn((b: Blob) => { capturedBlob = b; return 'blob:named'; });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => document.body);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    exportBubbles(SAMPLE_BUBBLES, { name: 'Q3 planning', savedAt: 123, savedBy: 'web' });

    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    const file = new File([await capturedBlob!.text()], 'named.json', { type: 'application/json' });
    const result = await importBubbles(file);
    expect(result?.bubbles).toEqual(SAMPLE_BUBBLES);
    expect(result?.name).toBe('Q3 planning');
  });

  it('a file exported via exportBubbles can be re-imported to recover the exact bubble array', async () => {
    // Capture the Blob written by exportBubbles.
    let capturedBlob: Blob | undefined;
    const createObjectURL = vi.fn((b: Blob) => { capturedBlob = b; return 'blob:rt'; });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.body);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => document.body);
    vi.spyOn(document, 'createElement').mockReturnValue(
      Object.assign(document.createElement('a'), { click: vi.fn() }),
    );

    exportBubbles(SAMPLE_BUBBLES);

    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    expect(capturedBlob).toBeDefined();
    const text = await capturedBlob!.text();
    const file = new File([text], 'round-trip.json', { type: 'application/json' });
    const result = await importBubbles(file);
    expect(result?.bubbles).toEqual(SAMPLE_BUBBLES);
  });
});
