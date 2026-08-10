/**
 * Mobile persistence: local drafts, import validation, and the cloud contract.
 *
 * These mirror the web suite (mind-canvas/src/persistence.test.ts) on purpose.
 * The two platforms hold SEPARATE copies of these validators, so a rule proven
 * on one says nothing about the other — and the failure mode is silent: a map
 * one platform accepts and the other rejects doesn't error, it just stops
 * syncing while both devices keep reporting success locally.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  saveBubbles, loadStoredState, parseBubbleJson, pushToCloud, fetchFromCloud,
} from './persistence';
import { STORAGE_KEY, STORAGE_VERSION, type BubbleData, type StoredState } from './bubbleTypes';
import { __reset, __seed, __setFailWrites } from '../test/stubs/async-storage';
import { setPlatform } from '../test/stubs/react-native';

const SAMPLE: BubbleData[] = [
  { id: 'b0', label: 'Root',  x: 0,   y: 0,   color: '#a1a1c1', depth: 0 },
  { id: 'b1', label: 'Child', x: 120, y: 0,   color: '#b2c2a2', depth: 1, parentId: 'b0', angle: 0, radial: 1 },
  { id: 'b2', label: 'Pip',   x: 120, y: 40,  color: '#c3b3d3', depth: 2, parentId: 'b1', scale: 1.2 },
];

const INITIAL: BubbleData[] = [
  { id: 'seed', label: 'Seed', x: 0, y: 0, color: '#ddd', depth: 0 },
];

function stored(state: StoredState): void {
  __seed(STORAGE_KEY, JSON.stringify(state));
}

beforeEach(() => {
  __reset();
  setPlatform('ios');
  delete process.env['EXPO_PUBLIC_API_URL'];
  delete process.env['EXPO_PUBLIC_DOMAIN'];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Local draft round-trip ───────────────────────────────────────────────────

describe('saveBubbles / loadStoredState', () => {
  it('restores the exact bubble array after a save', async () => {
    await saveBubbles(SAMPLE);
    const { bubbles } = await loadStoredState(INITIAL);
    expect(bubbles).toEqual(SAMPLE);
  });

  it('round-trips the save metadata, not just the bubbles', async () => {
    await saveBubbles(SAMPLE, { name: 'Trip', savedAt: 1_700_000_000_000, savedBy: 'mobile' });
    const { meta } = await loadStoredState(INITIAL);
    expect(meta).toEqual({ name: 'Trip', savedAt: 1_700_000_000_000, savedBy: 'mobile' });
  });

  it('reports false when the write fails instead of pretending it saved', async () => {
    __setFailWrites(true);
    expect(await saveBubbles(SAMPLE)).toBe(false);
  });

  it('returns hadStored: false on a fresh install, so the cloud can be adopted silently', async () => {
    const { bubbles, hadStored } = await loadStoredState(INITIAL);
    expect(hadStored).toBe(false);
    expect(bubbles).toEqual(INITIAL);
  });

  it('returns hadStored: true once something has actually been stored', async () => {
    await saveBubbles(SAMPLE);
    expect((await loadStoredState(INITIAL)).hadStored).toBe(true);
  });

  it('accepts a legacy version-1 draft rather than discarding the user’s work', async () => {
    stored({ version: 1, bubbles: SAMPLE });
    expect((await loadStoredState(INITIAL)).bubbles).toEqual(SAMPLE);
  });

  it.each([
    ['an unrecognised version', { version: 99, bubbles: SAMPLE }],
    ['an empty bubbles array',  { version: STORAGE_VERSION, bubbles: [] }],
  ])('falls back to the initial map for %s', async (_label, state) => {
    stored(state as StoredState);
    const { bubbles, hadStored } = await loadStoredState(INITIAL);
    expect(bubbles).toEqual(INITIAL);
    expect(hadStored).toBe(false);
  });

  it('does not throw on garbage in storage', async () => {
    __seed(STORAGE_KEY, 'not json at all!!!');
    expect((await loadStoredState(INITIAL)).bubbles).toEqual(INITIAL);
  });

  // The crash-loop case: a poisoned session persists non-finite coordinates as
  // `null`, and reloading them turns a one-off glitch into a broken launch
  // every single time — RN throws on NaN layout values.
  it('refuses a stored draft carrying a null coordinate', async () => {
    stored({
      version: STORAGE_VERSION,
      bubbles: [{ ...SAMPLE[0], x: null as unknown as number }],
    });
    expect((await loadStoredState(INITIAL)).bubbles).toEqual(INITIAL);
  });

  it('refuses a stored draft whose parent chain forms a cycle', async () => {
    stored({
      version: STORAGE_VERSION,
      bubbles: [
        { ...SAMPLE[0], id: 'a', parentId: 'b' },
        { ...SAMPLE[0], id: 'b', parentId: 'a' },
      ],
    });
    expect((await loadStoredState(INITIAL)).bubbles).toEqual(INITIAL);
  });
});

// ─── Import validation ────────────────────────────────────────────────────────

describe('parseBubbleJson', () => {
  it('accepts a current-version export and returns its bubbles', () => {
    const result = parseBubbleJson(JSON.stringify({ version: STORAGE_VERSION, bubbles: SAMPLE }));
    expect(result?.bubbles).toEqual(SAMPLE);
  });

  it('accepts a version-1 file (legacy export from either platform)', () => {
    expect(parseBubbleJson(JSON.stringify({ version: 1, bubbles: SAMPLE }))?.bubbles).toEqual(SAMPLE);
  });

  it('carries the canvas name out of the file', () => {
    const result = parseBubbleJson(JSON.stringify({
      version: STORAGE_VERSION, bubbles: SAMPLE, name: 'Product strategy',
    }));
    expect(result?.name).toBe('Product strategy');
  });

  it('leaves the name undefined when the file has none, so the caller can clear it', () => {
    const result = parseBubbleJson(JSON.stringify({ version: STORAGE_VERSION, bubbles: SAMPLE }));
    expect(result?.name).toBeUndefined();
  });

  // A file is not a cloud save. Adopting its savedAt would convince this device
  // it had already seen a remote save it has never seen, silently suppressing
  // the "new save available" prompt for genuinely newer work.
  it('does not carry savedAt or savedBy out of the file', () => {
    const result = parseBubbleJson(JSON.stringify({
      version: STORAGE_VERSION, bubbles: SAMPLE, savedAt: 1, savedBy: 'web',
    }));
    expect(result).not.toHaveProperty('savedAt');
    expect(result).not.toHaveProperty('savedBy');
  });

  it.each([
    ['non-JSON text',            'nope {{{'],
    ['an unknown version',       JSON.stringify({ version: 99, bubbles: SAMPLE })],
    ['an empty bubbles array',   JSON.stringify({ version: STORAGE_VERSION, bubbles: [] })],
    ['a missing required field', JSON.stringify({ version: STORAGE_VERSION, bubbles: [{ id: 'x', label: 'no coords' }] })],
    ['a null coordinate',        JSON.stringify({ version: STORAGE_VERSION, bubbles: [{ ...SAMPLE[0], x: null }] })],
    ['a duplicate id',           JSON.stringify({ version: STORAGE_VERSION, bubbles: [SAMPLE[0], SAMPLE[0]] })],
    ['an orphaned parentId',     JSON.stringify({ version: STORAGE_VERSION, bubbles: [{ ...SAMPLE[0], parentId: 'ghost' }] })],
    ['a parent cycle',           JSON.stringify({ version: STORAGE_VERSION, bubbles: [
      { ...SAMPLE[0], id: 'a', parentId: 'b' }, { ...SAMPLE[0], id: 'b', parentId: 'a' },
    ] })],
  ])('returns null for %s', (_label, text) => {
    expect(parseBubbleJson(text)).toBeNull();
  });
});

// ─── Cloud contract ───────────────────────────────────────────────────────────

describe('pushToCloud', () => {
  it('fails with "not-configured" on a native build with no API URL', async () => {
    // This is the published-app case: EXPO_PUBLIC_* values are baked in at
    // build time, and a build that received none previously reported SUCCESS
    // while writing nothing at all.
    const result = await pushToCloud(SAMPLE, { savedAt: 1, savedBy: 'mobile' });
    expect(result).toEqual({ ok: false, reason: 'not-configured' });
  });

  it('falls back to the page origin on a web build, needing no build-time config', async () => {
    setPlatform('web');
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    expect(await pushToCloud(SAMPLE, { savedAt: 1 })).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/api/map');
  });

  it('prefers an explicit EXPO_PUBLIC_API_URL and strips trailing slashes', async () => {
    process.env['EXPO_PUBLIC_API_URL'] = 'http://192.168.0.5:8080//';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await pushToCloud(SAMPLE, {});
    expect(fetchMock.mock.calls[0][0]).toBe('http://192.168.0.5:8080/api/map');
  });

  it('sends the bubbles and metadata the server expects', async () => {
    process.env['EXPO_PUBLIC_API_URL'] = 'http://localhost:8080';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await pushToCloud(SAMPLE, { name: 'Trip', savedAt: 42, savedBy: 'mobile' });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      version: STORAGE_VERSION, bubbles: SAMPLE, name: 'Trip', savedAt: 42, savedBy: 'mobile',
    });
  });

  it('reports "rejected" when the server answers but refuses', async () => {
    process.env['EXPO_PUBLIC_API_URL'] = 'http://localhost:8080';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    expect(await pushToCloud(SAMPLE, {})).toEqual({ ok: false, reason: 'rejected' });
  });

  it('reports "unreachable" when the request never completes', async () => {
    process.env['EXPO_PUBLIC_API_URL'] = 'http://localhost:8080';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network request failed')));
    expect(await pushToCloud(SAMPLE, {})).toEqual({ ok: false, reason: 'unreachable' });
  });
});

describe('fetchFromCloud', () => {
  beforeEach(() => { process.env['EXPO_PUBLIC_API_URL'] = 'http://localhost:8080'; });

  it('returns the bubbles and metadata from a valid response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 2, bubbles: SAMPLE, name: 'Shared', savedAt: 7, savedBy: 'web' }),
    }));
    const snap = await fetchFromCloud();
    expect(snap?.bubbles).toEqual(SAMPLE);
    expect(snap?.meta).toEqual({ name: 'Shared', savedAt: 7, savedBy: 'web' });
  });

  it('returns null when nothing has been saved yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => null }));
    expect(await fetchFromCloud()).toBeNull();
  });

  // /api/map is shared and (by default) unauthenticated, so its payload gets
  // the same scrutiny as a file from an unknown source. A cycle here would
  // hang the breadcrumb walk on every device that loaded it.
  it.each([
    ['a null coordinate', { version: 2, bubbles: [{ ...SAMPLE[0], x: null }] }],
    ['a parent cycle',    { version: 2, bubbles: [
      { ...SAMPLE[0], id: 'a', parentId: 'b' }, { ...SAMPLE[0], id: 'b', parentId: 'a' },
    ] }],
    ['an empty map',      { version: 2, bubbles: [] }],
  ])('rejects a response containing %s', async (_label, payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
    expect(await fetchFromCloud()).toBeNull();
  });

  it('drops metadata of the wrong type rather than trusting it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 2, bubbles: SAMPLE, name: 42, savedAt: 'soon', savedBy: 'desktop' }),
    }));
    const snap = await fetchFromCloud();
    expect(snap?.meta).toEqual({ name: undefined, savedAt: undefined, savedBy: undefined });
  });

  it('returns null instead of throwing when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await fetchFromCloud()).toBeNull();
  });
});
