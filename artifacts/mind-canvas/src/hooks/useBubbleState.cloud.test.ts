/**
 * H5 regression coverage: the cloud-bootstrap fetch in useBubbleState must
 * reject a malformed or unsafe /api/map payload exactly like importBubbles
 * rejects a malformed uploaded file — /api/map is shared and unauthenticated,
 * so its response is no more trustworthy than a file from an unknown source.
 *
 * These tests mock global fetch and drive the real hook's bootstrap effect,
 * matching this codebase's "real hook, real effect" testing style.
 */
import { act } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BubbleData } from '../persistence';
import { useBubbleState } from './useBubbleState';

const SEED: BubbleData[] = [
  { id: 'r0', depth: 0, label: 'Root', x: 0, y: 0, color: 'hsl(250,60%,65%)' },
];

function mockFetchOnce(response: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(response),
  }));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('cloud bootstrap — malformed payloads are rejected', () => {
  it('ignores a payload with a cyclic parent chain', async () => {
    mockFetchOnce({
      version: 2,
      bubbles: [
        { id: 'a', depth: 1, label: 'A', x: 0, y: 0, color: '#fff', parentId: 'b' },
        { id: 'b', depth: 1, label: 'B', x: 0, y: 0, color: '#fff', parentId: 'a' },
      ],
    });

    const { result } = renderHook(() => useBubbleState(SEED));
    // Give the bootstrap fetch a tick to resolve without asserting on a
    // specific value never changing (which would pass trivially before the
    // fetch even settles) — wait for the settle flag it always sets, then
    // check state was left alone.
    await waitFor(() => expect(result.current.cloudSaveOk).toBe(true));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.bubbles).toEqual(SEED);
  });

  it('ignores a payload with an orphan parentId', async () => {
    mockFetchOnce({
      version: 2,
      bubbles: [
        { id: 'a', depth: 1, label: 'A', x: 0, y: 0, color: '#fff', parentId: 'does-not-exist' },
      ],
    });

    const { result } = renderHook(() => useBubbleState(SEED));
    await waitFor(() => expect(result.current.cloudSaveOk).toBe(true));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.bubbles).toEqual(SEED);
  });

  it('ignores a payload with a bubble missing required fields', async () => {
    mockFetchOnce({
      version: 2,
      bubbles: [{ id: 'a', label: 'A' /* missing x, y, color, depth */ }],
    });

    const { result } = renderHook(() => useBubbleState(SEED));
    await waitFor(() => expect(result.current.cloudSaveOk).toBe(true));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.bubbles).toEqual(SEED);
  });

  it('still adopts a well-formed payload', async () => {
    const cloudTree: BubbleData[] = [
      { id: 'cloud0', depth: 0, label: 'From cloud', x: 5, y: 5, color: '#abc' },
    ];
    mockFetchOnce({ version: 2, bubbles: cloudTree });

    const { result } = renderHook(() => useBubbleState(SEED));
    await waitFor(() => expect(result.current.bubbles).toEqual(cloudTree));
  });
});
