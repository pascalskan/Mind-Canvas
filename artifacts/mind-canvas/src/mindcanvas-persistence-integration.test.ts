/**
 * Integration tests: useBubbleState add / delete / rename → localStorage
 *
 * These tests render the *real* useBubbleState hook that MindCanvas uses.
 * They verify that each mutation handler (addBubble, deleteBubblesById,
 * renameBubble) drives the hook's internal useEffect to call saveBubbles with
 * the correct state, and that a subsequent loadBubbles round-trip restores the
 * expected bubble tree.
 *
 * A stale-closure regression — e.g. addBubble capturing an old `bubbles` value
 * and saving the wrong tree — will fail these tests because we assert on the
 * actual localStorage entry decoded by loadBubbles.
 */

import { act } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadBubbles, type BubbleData } from './persistence';
import { useBubbleState } from './hooks/useBubbleState';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FALLBACK: BubbleData[] = [
  { id: 'fallback', depth: 0, label: 'Fallback', x: 0, y: 0, color: 'hsl(0,0%,50%)' },
];

/** Minimal starting tree: one root with two children. */
const SEED: BubbleData[] = [
  { id: 'r0', depth: 0, label: 'Root',    x: 0,   y: 0,   color: 'hsl(250,60%,65%)' },
  { id: 'c1', depth: 1, label: 'Child 1', x: 200, y: 0,   color: 'hsl(250,60%,65%)', parentId: 'r0' },
  { id: 'c2', depth: 1, label: 'Child 2', x: 0,   y: 200, color: 'hsl(250,60%,65%)', parentId: 'r0' },
];

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Renders useBubbleState and waits for the initial saveBubbles effect to
 * settle before the test acts on the hook.
 */
function renderBubbleState(seed: BubbleData[] = SEED) {
  const hook = renderHook(() => useBubbleState(seed));
  return hook;
}

/** Reads back what the hook persisted via loadBubbles. */
function readStorage(): BubbleData[] {
  return loadBubbles(FALLBACK);
}

// ─── Add bubble ───────────────────────────────────────────────────────────────

describe('addBubble — real hook, real persistence effect', () => {
  it('persists a new root bubble to localStorage', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.addBubble('New Root', null, { color: 'hsl(340,60%,65%)' });
    });

    const saved = readStorage();
    expect(saved.find(b => b.label === 'New Root')).toBeDefined();
    expect(saved.find(b => b.label === 'New Root')?.depth).toBe(0);
  });

  it('persists a new child bubble with the correct parentId and depth', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.addBubble('Child 3', 'r0');
    });

    const saved = readStorage();
    const child = saved.find(b => b.label === 'Child 3');
    expect(child).toBeDefined();
    expect(child?.parentId).toBe('r0');
    expect(child?.depth).toBe(1);
  });

  it('does not discard existing bubbles when adding a new one', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.addBubble('Child 3', 'r0');
    });

    const saved = readStorage();
    // All three seed bubbles plus the new one must survive.
    expect(saved.find(b => b.id === 'r0')).toBeDefined();
    expect(saved.find(b => b.id === 'c1')).toBeDefined();
    expect(saved.find(b => b.id === 'c2')).toBeDefined();
    expect(saved).toHaveLength(4);
  });

  it('two sequential addBubble calls persist both new bubbles', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.addBubble('Alpha', 'r0');
    });

    await act(async () => {
      result.current.addBubble('Beta', 'r0');
    });

    const saved = readStorage();
    expect(saved.find(b => b.label === 'Alpha')).toBeDefined();
    expect(saved.find(b => b.label === 'Beta')).toBeDefined();
    expect(saved).toHaveLength(5);
  });

  it('a grandchild bubble gets depth 2 and the correct parentId', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.addBubble('Grandchild', 'c1');
    });

    const saved = readStorage();
    const gc = saved.find(b => b.label === 'Grandchild');
    expect(gc).toBeDefined();
    expect(gc?.parentId).toBe('c1');
    expect(gc?.depth).toBe(2);
  });

  it('ignores a parentId that does not exist in the tree', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.addBubble('Ghost child', 'does-not-exist');
    });

    // No new bubble should appear.
    const saved = readStorage();
    expect(saved).toHaveLength(SEED.length);
    expect(saved.find(b => b.label === 'Ghost child')).toBeUndefined();
  });
});

// ─── Delete bubble ────────────────────────────────────────────────────────────

describe('deleteBubblesById — real hook, real persistence effect', () => {
  it('removes a leaf bubble from localStorage', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.deleteBubblesById(new Set(['c1']));
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'c1')).toBeUndefined();
    // Sibling and root survive.
    expect(saved.find(b => b.id === 'c2')).toBeDefined();
    expect(saved.find(b => b.id === 'r0')).toBeDefined();
  });

  it('removing a parent also removes all its descendants', async () => {
    // Start with a grandchild: r0 → c1 → gc1; r0 → c2
    const withGc: BubbleData[] = [
      ...SEED,
      { id: 'gc1', depth: 2, label: 'Grandchild', x: 300, y: 100,
        color: 'hsl(250,60%,65%)', parentId: 'c1' },
    ];

    const { result } = renderBubbleState(withGc);

    await act(async () => {
      // Delete c1 and its subtree (gc1)
      result.current.deleteBubblesById(new Set(['c1', 'gc1']));
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'c1')).toBeUndefined();
    expect(saved.find(b => b.id === 'gc1')).toBeUndefined();
    // Sibling and root survive.
    expect(saved.find(b => b.id === 'c2')).toBeDefined();
    expect(saved.find(b => b.id === 'r0')).toBeDefined();
  });

  it('does not corrupt sibling fields after a deletion', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.deleteBubblesById(new Set(['c2']));
    });

    const saved = readStorage();
    const c1 = saved.find(b => b.id === 'c1');
    expect(c1).toBeDefined();
    expect(c1?.label).toBe('Child 1');
    expect(c1?.parentId).toBe('r0');
    expect(c1?.depth).toBe(1);
    expect(c1?.x).toBe(200);
    expect(c1?.y).toBe(0);
  });

  it('two sequential deletions each save the reduced tree correctly', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.deleteBubblesById(new Set(['c1']));
    });
    await act(async () => {
      result.current.deleteBubblesById(new Set(['c2']));
    });

    const saved = readStorage();
    // Only the root remains.
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('r0');
  });
});

// ─── Rename bubble ────────────────────────────────────────────────────────────

describe('renameBubble — real hook, real persistence effect', () => {
  it('persists the new label to localStorage', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.renameBubble('c1', 'Renamed Child');
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'c1')?.label).toBe('Renamed Child');
  });

  it('trims whitespace from the new label', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.renameBubble('c1', '  Padded  ');
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'c1')?.label).toBe('Padded');
  });

  it('keeps the old label when the new label is whitespace-only', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.renameBubble('c1', '   ');
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'c1')?.label).toBe('Child 1');
  });

  it('leaves all other bubble fields unchanged after rename', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.renameBubble('c1', 'Updated');
    });

    const saved = readStorage();
    const c1 = saved.find(b => b.id === 'c1')!;
    expect(c1.parentId).toBe('r0');
    expect(c1.depth).toBe(1);
    expect(c1.x).toBe(200);
    expect(c1.y).toBe(0);
    expect(c1.color).toBe('hsl(250,60%,65%)');
  });

  it('only renames the target bubble, leaving siblings untouched', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.renameBubble('c1', 'Changed');
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'c2')?.label).toBe('Child 2');
    expect(saved.find(b => b.id === 'r0')?.label).toBe('Root');
  });

  it('a second rename overwrites the first in localStorage', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.renameBubble('r0', 'First');
    });
    await act(async () => {
      result.current.renameBubble('r0', 'Second');
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'r0')?.label).toBe('Second');
  });
});

// ─── Combined sequences ───────────────────────────────────────────────────────

describe('combined add → rename → delete sequences', () => {
  it('add then rename stores only the final label', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.addBubble('Temporary', 'r0');
    });

    // Find the id of the newly added bubble via the hook's current state.
    const newBubble = result.current.bubbles.find(b => b.label === 'Temporary')!;
    expect(newBubble).toBeDefined();

    await act(async () => {
      result.current.renameBubble(newBubble.id, 'Permanent');
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === newBubble.id)?.label).toBe('Permanent');
    expect(saved.find(b => b.label === 'Temporary')).toBeUndefined();
  });

  it('add then delete results in the same tree as before the add', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.addBubble('Ephemeral', 'r0');
    });

    const newBubble = result.current.bubbles.find(b => b.label === 'Ephemeral')!;
    expect(newBubble).toBeDefined();

    await act(async () => {
      result.current.deleteBubblesById(new Set([newBubble.id]));
    });

    const saved = readStorage();
    expect(saved).toHaveLength(SEED.length);
    expect(saved.find(b => b.id === newBubble.id)).toBeUndefined();
  });

  it('delete then add does not resurrect the deleted bubble', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.deleteBubblesById(new Set(['c1']));
    });
    await act(async () => {
      result.current.addBubble('New Child', 'r0');
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'c1')).toBeUndefined();
    expect(saved.find(b => b.label === 'New Child')).toBeDefined();
  });

  it('hook state and localStorage stay in sync through every mutation', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.addBubble('X', 'r0');
    });
    await act(async () => {
      result.current.renameBubble('c2', 'C2-renamed');
    });
    await act(async () => {
      result.current.deleteBubblesById(new Set(['c1']));
    });

    const saved = readStorage();
    // Hook's in-memory state and localStorage must agree.
    expect(result.current.bubbles).toHaveLength(saved.length);
    for (const b of result.current.bubbles) {
      const persisted = saved.find(s => s.id === b.id);
      expect(persisted).toBeDefined();
      expect(persisted?.label).toBe(b.label);
    }

    // Specific assertions.
    expect(saved.find(b => b.id === 'c1')).toBeUndefined();
    expect(saved.find(b => b.id === 'c2')?.label).toBe('C2-renamed');
    expect(saved.find(b => b.label === 'X')).toBeDefined();
  });
});
