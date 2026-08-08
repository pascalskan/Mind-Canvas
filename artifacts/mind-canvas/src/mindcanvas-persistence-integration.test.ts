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

// ─── Drag-to-reposition ───────────────────────────────────────────────────────
// onBubbleMove in MindCanvas.tsx calls applyRootDrag / applyChildDrag (from
// lib/dragHelpers) inside a setBubbles updater.  These tests exercise those
// same pure functions and verify that the result is faithfully persisted by
// the hook's useEffect and survives a loadBubbles round-trip (page refresh).
//
// If applyRootDrag / applyChildDrag are broken, or if the hook's persistence
// effect develops a stale-closure bug, one or more of these tests will fail.

import { applyRootDrag, applyChildDrag } from './lib/dragHelpers';

// Leash band matching the SEED tree's layout.  The exact numbers are not
// meaningful; what matters is that they are self-consistent (minD < maxD).
const MOCK_BAND = { minD: 80, maxD: 320 };

// Simulated rendered position of r0 on screen (acts as c1/c2's parent).
const PARENT_POS = { x: 50, y: 50 };

describe('drag-to-reposition — applyRootDrag → persistence', () => {
  it('persists updated x/y after a root bubble is dragged', async () => {
    const { result } = renderBubbleState();

    const r0 = result.current.bubbles.find(b => b.id === 'r0')!;
    // Simulate: originBx=r0.x, originBy=r0.y, sdx=300, sdy=-150
    const sdx = 300, sdy = -150;
    const expected = applyRootDrag(r0, r0.x, r0.y, sdx, sdy);

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'r0' ? applyRootDrag(b, b.x, b.y, sdx, sdy) : b),
      );
    });

    const saved = readStorage();
    const persisted = saved.find(b => b.id === 'r0');
    expect(persisted?.x).toBeCloseTo(expected.x);
    expect(persisted?.y).toBeCloseTo(expected.y);
  });

  it('loadBubbles restores the dragged root x/y exactly after a round-trip', async () => {
    const { result } = renderBubbleState();

    const r0 = result.current.bubbles.find(b => b.id === 'r0')!;
    const sdx = -200, sdy = 400;
    const expected = applyRootDrag(r0, r0.x, r0.y, sdx, sdy);

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'r0' ? applyRootDrag(b, b.x, b.y, sdx, sdy) : b),
      );
    });

    // Simulate page refresh.
    const restored = loadBubbles(FALLBACK);
    const r0After = restored.find(b => b.id === 'r0');
    expect(r0After?.x).toBeCloseTo(expected.x);
    expect(r0After?.y).toBeCloseTo(expected.y);
    // angle / radial should remain absent for a root bubble.
    expect(r0After?.angle).toBeUndefined();
    expect(r0After?.radial).toBeUndefined();
  });

  it('two sequential root drags persist the final position', async () => {
    const { result } = renderBubbleState();

    const r0 = result.current.bubbles.find(b => b.id === 'r0')!;
    const first = applyRootDrag(r0, r0.x, r0.y, 100, 50);
    const second = applyRootDrag(first, first.x, first.y, -30, 70);

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'r0' ? applyRootDrag(b, b.x, b.y, 100, 50) : b),
      );
    });
    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => {
          if (b.id !== 'r0') return b;
          return applyRootDrag(b, b.x, b.y, -30, 70);
        }),
      );
    });

    const saved = readStorage();
    const persisted = saved.find(b => b.id === 'r0');
    expect(persisted?.x).toBeCloseTo(second.x);
    expect(persisted?.y).toBeCloseTo(second.y);
  });
});

describe('drag-to-reposition — applyChildDrag → persistence', () => {
  it('persists angle and radial (not x/y) after a child bubble is dragged', async () => {
    const { result } = renderBubbleState();

    const c1 = result.current.bubbles.find(b => b.id === 'c1')!;
    // Simulate: originRx=220, originRy=10, sdx=60, sdy=80
    const originRx = 220, originRy = 10, sdx = 60, sdy = 80;
    const expected = applyChildDrag(c1, originRx, originRy, sdx, sdy, PARENT_POS, MOCK_BAND);

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b =>
          b.id === 'c1'
            ? applyChildDrag(b, originRx, originRy, sdx, sdy, PARENT_POS, MOCK_BAND)
            : b,
        ),
      );
    });

    const saved = readStorage();
    const persisted = saved.find(b => b.id === 'c1');
    expect(persisted?.angle).toBeCloseTo(expected.angle!);
    expect(persisted?.radial).toBeCloseTo(expected.radial!);
    // World x/y are unchanged for a child drag.
    expect(persisted?.x).toBe(c1.x);
    expect(persisted?.y).toBe(c1.y);
  });

  it('loadBubbles restores dragged angle/radial exactly after a round-trip', async () => {
    const { result } = renderBubbleState();

    const c2 = result.current.bubbles.find(b => b.id === 'c2')!;
    const originRx = 60, originRy = 230, sdx = -40, sdy = 100;
    const expected = applyChildDrag(c2, originRx, originRy, sdx, sdy, PARENT_POS, MOCK_BAND);

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b =>
          b.id === 'c2'
            ? applyChildDrag(b, originRx, originRy, sdx, sdy, PARENT_POS, MOCK_BAND)
            : b,
        ),
      );
    });

    // Simulate page refresh.
    const restored = loadBubbles(FALLBACK);
    const c2After = restored.find(b => b.id === 'c2');
    expect(c2After?.angle).toBeCloseTo(expected.angle!);
    expect(c2After?.radial).toBeCloseTo(expected.radial!);
  });

  it('only the dragged child changes; siblings keep their original fields', async () => {
    const { result } = renderBubbleState();

    const c1 = result.current.bubbles.find(b => b.id === 'c1')!;

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b =>
          b.id === 'c1'
            ? applyChildDrag(b, 220, 10, 50, 50, PARENT_POS, MOCK_BAND)
            : b,
        ),
      );
    });

    const saved = readStorage();
    // c2 must be untouched.
    const c2 = saved.find(b => b.id === 'c2')!;
    expect(c2.x).toBe(0);
    expect(c2.y).toBe(200);
    expect(c2.angle).toBeUndefined();
    expect(c2.radial).toBeUndefined();
    // Root must be untouched.
    const r0 = saved.find(b => b.id === 'r0')!;
    expect(r0.x).toBe(0);
    expect(r0.y).toBe(0);
    // c1's world coords stay the same; only angle/radial change.
    const c1After = saved.find(b => b.id === 'c1')!;
    expect(c1After.x).toBe(c1.x);
    expect(c1After.y).toBe(c1.y);
  });

  it('hook in-memory state and localStorage agree after a child drag', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b =>
          b.id === 'c1'
            ? applyChildDrag(b, 220, 10, 80, -60, PARENT_POS, MOCK_BAND)
            : b,
        ),
      );
    });

    const saved  = readStorage();
    const inMem  = result.current.bubbles.find(b => b.id === 'c1');
    const onDisk = saved.find(b => b.id === 'c1');

    expect(inMem?.angle).toBeCloseTo(onDisk?.angle!);
    expect(inMem?.radial).toBeCloseTo(onDisk?.radial!);
  });

  it('radial is clamped to [0, 1] when the pointer moves beyond the leash', async () => {
    const { result } = renderBubbleState();

    const c1 = result.current.bubbles.find(b => b.id === 'c1')!;
    // Push far beyond maxD to exercise the clamp01 ceiling.
    const expected = applyChildDrag(c1, 220, 10, 5000, 5000, PARENT_POS, MOCK_BAND);
    expect(expected.radial).toBeLessThanOrEqual(1);

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b =>
          b.id === 'c1'
            ? applyChildDrag(b, 220, 10, 5000, 5000, PARENT_POS, MOCK_BAND)
            : b,
        ),
      );
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'c1')?.radial).toBeLessThanOrEqual(1);
    expect(saved.find(b => b.id === 'c1')?.radial).toBeGreaterThanOrEqual(0);
  });
});

// ─── Scale changes ────────────────────────────────────────────────────────────
// The size-picker in MindCanvas.tsx writes `scale` back to state via setBubbles,
// exactly the same code path as a drag.  These tests confirm that scale changes
// survive a save / loadBubbles round-trip (simulated page refresh) and that
// edge-case values (min, max, removed) are handled correctly.

import { SCALE_MIN, SCALE_MAX } from './lib/bubbleLayout';

describe('scale changes — setBubbles → persistence', () => {
  it('persists a scale value set on a root bubble', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'r0' ? { ...b, scale: 1.4 } : b),
      );
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'r0')?.scale).toBeCloseTo(1.4);
  });

  it('persists a scale value set on a child bubble', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'c1' ? { ...b, scale: 0.6 } : b),
      );
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'c1')?.scale).toBeCloseTo(0.6);
  });

  it('loadBubbles restores the scale exactly after a round-trip', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'c2' ? { ...b, scale: 1.7 } : b),
      );
    });

    // Simulate page refresh.
    const restored = loadBubbles(FALLBACK);
    expect(restored.find(b => b.id === 'c2')?.scale).toBeCloseTo(1.7);
  });

  it('persists SCALE_MIN (minimum allowed scale)', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'c1' ? { ...b, scale: SCALE_MIN } : b),
      );
    });

    const restored = loadBubbles(FALLBACK);
    expect(restored.find(b => b.id === 'c1')?.scale).toBeCloseTo(SCALE_MIN);
  });

  it('persists SCALE_MAX (maximum allowed scale)', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'r0' ? { ...b, scale: SCALE_MAX } : b),
      );
    });

    const restored = loadBubbles(FALLBACK);
    expect(restored.find(b => b.id === 'r0')?.scale).toBeCloseTo(SCALE_MAX);
  });

  it('scale absent (undefined) means default — loadBubbles restores it as undefined', async () => {
    // Start with a bubble that already has a scale, then remove it.
    const withScale: BubbleData[] = [
      ...SEED.map(b => b.id === 'c1' ? { ...b, scale: 1.3 } : b),
    ];
    const { result } = renderBubbleState(withScale);

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => {
          if (b.id !== 'c1') return b;
          const { scale: _removed, ...rest } = b;
          return rest as typeof b;
        }),
      );
    });

    const restored = loadBubbles(FALLBACK);
    expect(restored.find(b => b.id === 'c1')?.scale).toBeUndefined();
  });

  it('only the target bubble scale changes; siblings are untouched', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'c1' ? { ...b, scale: 1.2 } : b),
      );
    });

    const saved = readStorage();
    // Sibling and root must not have an unexpected scale field.
    expect(saved.find(b => b.id === 'c2')?.scale).toBeUndefined();
    expect(saved.find(b => b.id === 'r0')?.scale).toBeUndefined();
    expect(saved.find(b => b.id === 'c1')?.scale).toBeCloseTo(1.2);
  });

  it('two sequential scale changes persist only the final value', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'r0' ? { ...b, scale: 0.8 } : b),
      );
    });
    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'r0' ? { ...b, scale: 1.5 } : b),
      );
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'r0')?.scale).toBeCloseTo(1.5);
  });

  it('hook in-memory state and localStorage agree after a scale change', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'c2' ? { ...b, scale: 1.1 } : b),
      );
    });

    const saved  = readStorage();
    const inMem  = result.current.bubbles.find(b => b.id === 'c2');
    const onDisk = saved.find(b => b.id === 'c2');

    expect(inMem?.scale).toBeCloseTo(onDisk?.scale!);
  });

  it('scale survives an interleaved rename without being lost', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'c1' ? { ...b, scale: 1.6 } : b),
      );
    });
    await act(async () => {
      result.current.renameBubble('c1', 'Renamed');
    });

    const restored = loadBubbles(FALLBACK);
    const c1 = restored.find(b => b.id === 'c1');
    expect(c1?.label).toBe('Renamed');
    expect(c1?.scale).toBeCloseTo(1.6);
  });
});

// ─── Color changes ────────────────────────────────────────────────────────────
// The color-picker in MindCanvas.tsx writes a new `color` back to state via
// setBubbles — the same code path as scale or drag.  These tests confirm that
// color changes survive a saveBubbles / loadBubbles round-trip (simulated page
// refresh) and that edge cases (root vs. child, propagation, sequential
// overwrites) are handled correctly.

describe('color changes — setBubbles → persistence', () => {
  it('persists a color change on a root bubble', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'r0' ? { ...b, color: 'hsl(120,60%,55%)' } : b),
      );
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'r0')?.color).toBe('hsl(120,60%,55%)');
  });

  it('persists a color change on a child bubble', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'c1' ? { ...b, color: 'hsl(30,80%,60%)' } : b),
      );
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'c1')?.color).toBe('hsl(30,80%,60%)');
  });

  it('loadBubbles restores the changed color exactly after a round-trip', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'c2' ? { ...b, color: 'hsl(200,70%,50%)' } : b),
      );
    });

    // Simulate page refresh.
    const restored = loadBubbles(FALLBACK);
    expect(restored.find(b => b.id === 'c2')?.color).toBe('hsl(200,70%,50%)');
  });

  it('color propagated to a child persists independently of the root color', async () => {
    // Simulate the pattern where a root-color change is also applied to its
    // children (as the app does when reassigning a root color).
    const newColor = 'hsl(300,55%,60%)';

    await act(async () => {
      // Render first so we get a hook to work with.
    });

    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b =>
          b.id === 'r0' || b.parentId === 'r0'
            ? { ...b, color: newColor }
            : b,
        ),
      );
    });

    const restored = loadBubbles(FALLBACK);
    expect(restored.find(b => b.id === 'r0')?.color).toBe(newColor);
    expect(restored.find(b => b.id === 'c1')?.color).toBe(newColor);
    expect(restored.find(b => b.id === 'c2')?.color).toBe(newColor);
  });

  it('two sequential color changes persist only the final value', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'r0' ? { ...b, color: 'hsl(10,60%,50%)' } : b),
      );
    });
    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'r0' ? { ...b, color: 'hsl(180,60%,50%)' } : b),
      );
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'r0')?.color).toBe('hsl(180,60%,50%)');
  });

  it('only the target bubble color changes; siblings are untouched', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'c1' ? { ...b, color: 'hsl(60,70%,55%)' } : b),
      );
    });

    const saved = readStorage();
    expect(saved.find(b => b.id === 'c1')?.color).toBe('hsl(60,70%,55%)');
    // Sibling and root must keep their original seed colors.
    expect(saved.find(b => b.id === 'c2')?.color).toBe('hsl(250,60%,65%)');
    expect(saved.find(b => b.id === 'r0')?.color).toBe('hsl(250,60%,65%)');
  });

  it('hook in-memory state and localStorage agree after a color change', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'c2' ? { ...b, color: 'hsl(90,65%,45%)' } : b),
      );
    });

    const saved  = readStorage();
    const inMem  = result.current.bubbles.find(b => b.id === 'c2');
    const onDisk = saved.find(b => b.id === 'c2');

    expect(inMem?.color).toBe(onDisk?.color);
  });

  it('color survives an interleaved rename without being lost', async () => {
    const { result } = renderBubbleState();

    await act(async () => {
      result.current.setBubbles(prev =>
        prev.map(b => b.id === 'c1' ? { ...b, color: 'hsl(340,75%,55%)' } : b),
      );
    });
    await act(async () => {
      result.current.renameBubble('c1', 'Renamed');
    });

    const restored = loadBubbles(FALLBACK);
    const c1 = restored.find(b => b.id === 'c1');
    expect(c1?.label).toBe('Renamed');
    expect(c1?.color).toBe('hsl(340,75%,55%)');
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
