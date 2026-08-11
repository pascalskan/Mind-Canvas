/**
 * Manual-save model: editing is local-only, the cloud is only ever written by
 * an explicit "Save canvas", and a newer remote save is OFFERED rather than
 * applied.
 *
 * These replace the old transactional-edit tests, which asserted the previous
 * auto-push behaviour (every mutation PUT to the cloud, suspended during edit
 * mode). Auto-push is gone entirely, so "does it push on edit?" is no longer a
 * meaningful question — "does it push ONLY on save?" is.
 *
 * Tests drive the real hook and inspect real fetch calls, matching this
 * codebase's "real hook, real effect" style.
 */
import { act } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveBubbles, type BubbleData } from '../persistence';
import { useBubbleState, type PushResult } from './useBubbleState';

const SEED: BubbleData[] = [
  { id: 'r0', depth: 0, label: 'Root', x: 0, y: 0, color: 'hsl(250,60%,65%)' },
];

/** A cloud map that looks like it was saved on the phone at `savedAt`. */
function cloudPayload(savedAt: number, label = 'From phone', name?: string) {
  return {
    version: 2,
    name,
    savedAt,
    savedBy: 'mobile',
    bubbles: [{ id: 'r0', depth: 0, label, x: 0, y: 0, color: '#abc' }],
  };
}

function mockFetch(getBody: unknown = null) {
  const fn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(getBody) });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const putCalls = (m: ReturnType<typeof mockFetch>) =>
  m.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');

/** Seeds localStorage so the hook starts as a device with existing work. */
function seedLocalDraft(savedAt = 0) {
  saveBubbles(SEED, { savedAt: savedAt || undefined });
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe('editing never reaches the cloud', () => {
  it('mutations do not PUT — only localStorage is written', async () => {
    const fetchMock = mockFetch();
    const { result } = renderHook(() => useBubbleState(SEED));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled()); // bootstrap GET
    fetchMock.mockClear();

    await act(async () => { result.current.renameBubble('r0', 'Edited once'); });
    await act(async () => { result.current.addBubble('Another', null); });
    await new Promise(r => setTimeout(r, 20));

    expect(putCalls(fetchMock)).toHaveLength(0);
    // The draft is still safe locally — that is the whole point of keeping
    // local autosave while removing the cloud push.
    expect(localStorage.getItem('mind-canvas-bubbles')).not.toBeNull();
  });
});

describe('saveCanvas', () => {
  it('PUTs once, carrying the bubbles, name, savedAt and savedBy', async () => {
    const fetchMock = mockFetch();
    const { result } = renderHook(() => useBubbleState(SEED));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    await act(async () => { result.current.setCanvasName('Trip planning'); });
    await act(async () => { result.current.renameBubble('r0', 'Draft'); });
    fetchMock.mockClear();

    await act(async () => { await result.current.saveCanvas(); });

    const puts = putCalls(fetchMock);
    expect(puts).toHaveLength(1);
    const body = JSON.parse((puts[0][1] as RequestInit).body as string);
    expect(body.bubbles.find((b: BubbleData) => b.id === 'r0').label).toBe('Draft');
    expect(body.name).toBe('Trip planning');
    expect(body.savedBy).toBe('web');
    // savedAt is deliberately NOT sent. The server stamps it, so every device
    // orders saves by one clock — see the map.ts PUT handler. Sending a local
    // reading is what let two devices with skewed clocks ignore each other's
    // work while both reported themselves in sync.
    expect(body.savedAt).toBeUndefined();
  });

  it('reports failure without throwing when the server rejects the write', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(null) }),
    ));
    const { result } = renderHook(() => useBubbleState(SEED));

    let outcome: PushResult | undefined;
    await act(async () => { outcome = await result.current.saveCanvas(); });

    expect(outcome).toEqual({ ok: false, reason: 'rejected' });
    await waitFor(() => expect(result.current.cloudSaveOk).toBe(false));
    // The reason is what lets Settings say something specific instead of a
    // generic "save failed" — a rejection and an unreachable server need
    // different advice.
    expect(result.current.saveError).toBe('rejected');
  });

  it('reports "unreachable" — not "rejected" — when the request never completes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve({ ok: true, json: () => Promise.resolve(null) }),
    ));
    const { result } = renderHook(() => useBubbleState(SEED));

    let outcome: PushResult | undefined;
    await act(async () => { outcome = await result.current.saveCanvas(); });

    expect(outcome).toEqual({ ok: false, reason: 'unreachable' });
    await waitFor(() => expect(result.current.saveError).toBe('unreachable'));
  });

  it('leaves the canvas dirty when the save fails, so the work is not presented as safe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(null) }),
    ));
    const { result } = renderHook(() => useBubbleState(SEED));

    await act(async () => { result.current.renameBubble('r0', 'Unsaved work'); });
    await waitFor(() => expect(result.current.hasUnsavedChanges).toBe(true));

    await act(async () => { await result.current.saveCanvas(); });

    // A failed save must not clear the unsaved-changes marker: the whole point
    // of the indicator is to be trustworthy when something has gone wrong.
    expect(result.current.hasUnsavedChanges).toBe(true);
  });

  it('clears the unsaved-changes marker once a save succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(null) }),
    ));
    const { result } = renderHook(() => useBubbleState(SEED));

    await act(async () => { result.current.renameBubble('r0', 'Saved work'); });
    await waitFor(() => expect(result.current.hasUnsavedChanges).toBe(true));

    await act(async () => { await result.current.saveCanvas(); });

    await waitFor(() => expect(result.current.hasUnsavedChanges).toBe(false));
    expect(result.current.saveError).toBeNull();
  });
});

describe('a newer save is offered, never applied', () => {
  it('raises a prompt at startup instead of overwriting local work', async () => {
    seedLocalDraft();
    mockFetch(cloudPayload(Date.now(), 'From phone', 'Phone canvas'));

    const { result } = renderHook(() => useBubbleState(SEED));

    await waitFor(() => expect(result.current.pendingSave).not.toBeNull());
    // Crucially the canvas itself is untouched until the user chooses.
    expect(result.current.bubbles.find(b => b.id === 'r0')?.label).toBe('Root');
    expect(result.current.pendingSave?.meta.savedBy).toBe('mobile');
    expect(result.current.pendingSave?.meta.name).toBe('Phone canvas');
  });

  it('accepting adopts the remote bubbles and name', async () => {
    seedLocalDraft();
    mockFetch(cloudPayload(Date.now(), 'From phone', 'Phone canvas'));
    const { result } = renderHook(() => useBubbleState(SEED));
    await waitFor(() => expect(result.current.pendingSave).not.toBeNull());

    await act(async () => { result.current.acceptPendingSave(); });

    expect(result.current.bubbles.find(b => b.id === 'r0')?.label).toBe('From phone');
    expect(result.current.canvasName).toBe('Phone canvas');
    expect(result.current.pendingSave).toBeNull();
  });

  it('dismissing keeps local work and does not re-offer the same save', async () => {
    vi.useFakeTimers();
    try {
      seedLocalDraft();
      mockFetch(cloudPayload(Date.now()));
      const { result } = renderHook(() => useBubbleState(SEED));

      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.pendingSave).not.toBeNull();

      await act(async () => { result.current.dismissPendingSave(); });
      expect(result.current.pendingSave).toBeNull();
      expect(result.current.bubbles.find(b => b.id === 'r0')?.label).toBe('Root');

      // Two full check intervals pass with the same save still on the server.
      // Marking it seen on dismiss is what stops it nagging every 30 s.
      for (let i = 0; i < 70; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_000);
          await Promise.resolve();
        });
      }
      expect(result.current.pendingSave).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not offer a save this device already has (its own save)', async () => {
    const savedAt = Date.now();
    seedLocalDraft(savedAt);
    mockFetch(cloudPayload(savedAt));

    const { result } = renderHook(() => useBubbleState(SEED));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.pendingSave).toBeNull();
  });

  it('adopts the cloud silently on a device with nothing stored yet', async () => {
    // No seedLocalDraft — a fresh browser has no work to protect, so
    // prompting would be noise.
    mockFetch(cloudPayload(Date.now(), 'From phone'));

    const { result } = renderHook(() => useBubbleState(SEED));

    await waitFor(() =>
      expect(result.current.bubbles.find(b => b.id === 'r0')?.label).toBe('From phone'));
    expect(result.current.pendingSave).toBeNull();
  });

  it('does not interrupt an active edit session', async () => {
    vi.useFakeTimers();
    try {
      seedLocalDraft();
      mockFetch(cloudPayload(Date.now()));
      // editModeActive = true for the whole session.
      const { result } = renderHook(() => useBubbleState(SEED, true));

      for (let i = 0; i < 40; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_000);
          await Promise.resolve();
        });
      }
      // The startup check still runs (it is not gated on edit mode), so assert
      // on the periodic check specifically: nothing was applied to the canvas.
      expect(result.current.bubbles.find(b => b.id === 'r0')?.label).toBe('Root');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Adopting without asking ──────────────────────────────────────────────────
//
// A newer save is taken silently when there is nothing here to protect, and
// only then. "Nothing to protect" means BOTH no unsaved changes AND no recent
// activity: a check that lands between the user reaching for the canvas and
// their first edit still sees a clean signature, and adopting there would swap
// the map out from under someone mid-thought.

describe('a newer save is adopted only when the canvas is clean AND idle', () => {
  /** Runs the periodic check to completion under fake timers. */
  async function runPollCycles(cycles = 40) {
    for (let i = 0; i < cycles; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
        await Promise.resolve();
      });
    }
  }

  /**
   * Starts the hook already in step with the cloud, so the STARTUP check has
   * nothing to offer and the periodic check is the only thing under test.
   * Returns a function that publishes a newer remote save.
   */
  function startInSync() {
    const seen = 1_000_000;
    seedLocalDraft(seen);
    let body: unknown = cloudPayload(seen, 'Root');
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(body) }),
    ));
    return () => { body = cloudPayload(seen + 60_000, 'Remote root'); };
  }

  it('adopts silently when nothing is unsaved and the user is idle', async () => {
    vi.useFakeTimers();
    try {
      const publishNewer = startInSync();
      const { result } = renderHook(() => useBubbleState(SEED));
      await runPollCycles(2);
      expect(result.current.pendingSave).toBeNull();   // in step to begin with

      publishNewer();
      await runPollCycles(40);

      expect(result.current.bubbles.find(b => b.id === 'r0')?.label).toBe('Remote root');
      expect(result.current.pendingSave).toBeNull();   // taken, never asked
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks instead of adopting when the user interacted moments ago', async () => {
    vi.useFakeTimers();
    try {
      const publishNewer = startInSync();
      const { result } = renderHook(() => useBubbleState(SEED));
      await runPollCycles(2);

      publishNewer();
      // Sit idle almost until the check fires, THEN touch the canvas — so the
      // check lands a second after the user reached for it. The signature is
      // still clean at that instant, which is exactly the window that used to
      // let the remote map replace work the user had only just started.
      await runPollCycles(27);
      await act(async () => {
        window.dispatchEvent(new Event('pointerdown'));
        await Promise.resolve();
      });
      await runPollCycles(3);

      // Offered, not applied.
      expect(result.current.pendingSave).not.toBeNull();
      expect(result.current.bubbles.find(b => b.id === 'r0')?.label).toBe('Root');
    } finally {
      vi.useRealTimers();
    }
  });
});
