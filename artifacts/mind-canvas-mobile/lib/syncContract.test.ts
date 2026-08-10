/**
 * Cross-platform sync contract.
 *
 * Web and mobile do not share code — each keeps its own copy of the layout
 * maths, the persistence validators, and the save-metadata rules — and the API
 * server keeps a third copy of the validation. Every other test in this repo
 * checks ONE of those three in isolation, which is exactly the blind spot that
 * matters: the failures that actually break syncing are disagreements BETWEEN
 * them, and a disagreement is silent. Nothing throws. Both devices keep saving
 * happily to their own local storage while the shared map quietly stops moving
 * between them.
 *
 * So this file deliberately reaches across package boundaries and imports the
 * real modules from all three sides, then asserts they agree.
 *
 * Note the web module is imported by relative path rather than by package
 * name. That is intentional: the point is to test the code that actually
 * ships, not a copy of it that could drift.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mobile
import { canvasSignature as mobileSignature, buildInitialBubbles } from './bubbleLayout';
import { parseBubbleJson, pushToCloud, fetchFromCloud } from './persistence';
import { STORAGE_VERSION, type BubbleData } from './bubbleTypes';

// Web
import { canvasSignature as webSignature } from '../../mind-canvas/src/hooks/useBubbleState';
import {
  isValidBubble as webIsValidBubble,
  isValidBubbleGraph as webIsValidGraph,
  STORAGE_VERSION as WEB_STORAGE_VERSION,
} from '../../mind-canvas/src/persistence';

// Server
import { validateMapPayload } from '../../api-server/src/lib/mapPayload';

const SAMPLE: BubbleData[] = [
  { id: 'b0', label: 'Root',  x: 0,   y: 0,   color: '#a1a1c1', depth: 0 },
  { id: 'b1', label: 'Child', x: 120, y: 0,   color: '#b2c2a2', depth: 1, parentId: 'b0', angle: 0.5, radial: 0.25 },
  { id: 'b2', label: 'Pip',   x: 130, y: 44,  color: '#c3b3d3', depth: 2, parentId: 'b1', scale: 1.2 },
];

beforeEach(() => {
  process.env['EXPO_PUBLIC_API_URL'] = 'http://localhost:8080';
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['EXPO_PUBLIC_API_URL'];
});

// ─── Storage format ───────────────────────────────────────────────────────────

describe('storage version', () => {
  // The clients read each other's files and the same cloud row. A version bump
  // on one side alone makes the other reject every payload as "unrecognised
  // version" — which looks exactly like a corrupt file, not a mismatch.
  it('is the same number on both platforms', () => {
    expect(STORAGE_VERSION).toBe(WEB_STORAGE_VERSION);
  });
});

// ─── Unsaved-changes fingerprint ──────────────────────────────────────────────

describe('canvasSignature agrees byte-for-byte across platforms', () => {
  // This drives the unsaved-changes dot on both platforms. If the two
  // implementations disagree, one device reports "all changes saved" for a
  // canvas the other considers dirty — over the identical bytes.
  it.each([
    ['a plain map',                SAMPLE, undefined],
    ['a named map',                SAMPLE, 'Product strategy'],
    ['the seeded starter map',     buildInitialBubbles(), undefined],
    ['a single root',              [SAMPLE[0]], 'Solo'],
  ])('matches for %s', (_label, bubbles, name) => {
    expect(mobileSignature(bubbles as BubbleData[], name))
      .toBe(webSignature(bubbles as never, name));
  });

  it('matches regardless of array order', () => {
    const reversed = [...SAMPLE].reverse();
    expect(mobileSignature(reversed)).toBe(webSignature(reversed as never));
    expect(mobileSignature(reversed)).toBe(mobileSignature(SAMPLE));
  });

  it('both platforms register the same edits as changes', () => {
    const edited = SAMPLE.map(b => b.id === 'b1' ? { ...b, label: 'Renamed' } : b);
    const mobileChanged = mobileSignature(edited) !== mobileSignature(SAMPLE);
    const webChanged = webSignature(edited as never) !== webSignature(SAMPLE as never);
    expect(mobileChanged).toBe(true);
    expect(webChanged).toBe(true);
  });

  it('both platforms ignore the same sub-pixel drift', () => {
    const drifted = SAMPLE.map(b => ({ ...b, x: b.x + 0.4, y: b.y - 0.4 }));
    expect(mobileSignature(drifted)).toBe(mobileSignature(SAMPLE));
    expect(webSignature(drifted as never)).toBe(webSignature(SAMPLE as never));
  });
});

// ─── Validation parity ────────────────────────────────────────────────────────

describe('the three validators accept and reject the same maps', () => {
  /** Runs a candidate map past mobile, web, and the server. */
  function verdicts(bubbles: unknown[]): { mobile: boolean; web: boolean; server: boolean } {
    const body = { version: STORAGE_VERSION, bubbles };
    return {
      mobile: parseBubbleJson(JSON.stringify(body)) !== null,
      web: (bubbles as BubbleData[]).length > 0
        && bubbles.every(webIsValidBubble)
        && webIsValidGraph(bubbles as BubbleData[]),
      server: validateMapPayload(body).ok,
    };
  }

  it('all three accept a well-formed map', () => {
    const v = verdicts(SAMPLE);
    expect(v).toEqual({ mobile: true, web: true, server: true });
  });

  it.each([
    ['an empty map',              []],
    ['a missing required field',  [{ id: 'x', label: 'no coords' }]],
    // JSON.stringify turns NaN into null, so this is the exact shape a
    // poisoned client puts on the wire — the one that silently killed sync.
    ['a null coordinate',         [{ ...SAMPLE[0], x: null }]],
    ['a non-finite scale',        [{ ...SAMPLE[0], scale: null }]],
    ['a duplicate id',            [SAMPLE[0], { ...SAMPLE[0], label: 'clash' }]],
    ['an orphaned parentId',      [{ ...SAMPLE[0], id: 'kid', parentId: 'ghost' }]],
    ['a parent cycle',            [
      { ...SAMPLE[0], id: 'a', parentId: 'b' },
      { ...SAMPLE[0], id: 'b', parentId: 'a' },
    ]],
  ])('all three reject %s', (_label, bubbles) => {
    const v = verdicts(bubbles as unknown[]);
    expect(v).toEqual({ mobile: false, web: false, server: false });
  });
});

// ─── Wire format ──────────────────────────────────────────────────────────────

describe('what mobile PUTs is what the server accepts', () => {
  it('a real mobile save passes server validation unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await pushToCloud(SAMPLE, { name: 'Trip planning', savedAt: 1_700_000_000_000, savedBy: 'mobile' });

    // Take the ACTUAL body off the wire rather than reconstructing it.
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    const result = validateMapPayload(sent);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Trip planning');
      expect(result.value.savedBy).toBe('mobile');
      expect(result.value.savedAt).toBe(1_700_000_000_000);
      expect(result.value.bubbles).toEqual(SAMPLE);
    }
  });

  it('a save with no name omits the field rather than sending null', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await pushToCloud(SAMPLE, { savedAt: 1, savedBy: 'mobile' });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    // `name: null` would fail the server's string check and reject the save.
    expect(sent.name === undefined || typeof sent.name === 'string').toBe(true);
    expect(validateMapPayload(sent).ok).toBe(true);
  });

  it('mobile reads back exactly what the server would store from a web save', async () => {
    // A web save, run through the server's own validator, then handed to
    // mobile's fetch path — the full cross-device round trip in one assertion.
    const webBody = {
      version: WEB_STORAGE_VERSION,
      bubbles: SAMPLE,
      name: 'From the website',
      savedAt: 1_700_000_000_500,
      savedBy: 'web' as const,
    };
    const validated = validateMapPayload(webBody);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => validated.value,
    }));

    const snap = await fetchFromCloud();
    expect(snap?.bubbles).toEqual(SAMPLE);
    expect(snap?.meta).toEqual({
      name: 'From the website', savedAt: 1_700_000_000_500, savedBy: 'web',
    });
  });

  it('an export written by mobile is importable and server-valid', () => {
    // Mirrors what exportMap writes, including the name that a round trip has
    // to preserve.
    const file = JSON.stringify({ version: STORAGE_VERSION, bubbles: SAMPLE, name: 'Exported' });

    const reimported = parseBubbleJson(file);
    expect(reimported?.bubbles).toEqual(SAMPLE);
    expect(reimported?.name).toBe('Exported');

    expect(validateMapPayload(JSON.parse(file)).ok).toBe(true);
  });
});
