import { describe, expect, it } from 'vitest';
import type { BubbleData } from '../persistence';
import { applyRootDrag, applyChildDrag, shouldWriteBubbleMotionValues, isBackgroundTap, descendantsOf } from './dragHelpers';

describe('applyRootDrag', () => {
  it('moves x/y by the world-space delta from the drag origin', () => {
    const bubble = { id: 'b0', depth: 0, label: 'Root', x: 100, y: 200, color: '#fff' };
    const moved = applyRootDrag(bubble, 100, 200, 30, -15);
    expect(moved.x).toBe(130);
    expect(moved.y).toBe(185);
  });
});

describe('applyChildDrag', () => {
  it('sets angle and radial from the pointer position relative to the parent', () => {
    const bubble = { id: 'c0', parentId: 'p0', depth: 1, label: 'Child', x: 0, y: 0, color: '#fff' };
    const moved = applyChildDrag(
      bubble, /* originRx */ 100, /* originRy */ 0, /* sdx */ 0, /* sdy */ 0,
      /* parentPos */ { x: 0, y: 0 }, /* band */ { minD: 50, maxD: 150 },
    );
    expect(moved.angle).toBeCloseTo(0);
    expect(moved.radial).toBeCloseTo(0.5); // (100 - 50) / (150 - 50)
  });

  it('clamps radial to [0, 1] when the pointer moves beyond the leash', () => {
    const bubble = { id: 'c0', parentId: 'p0', depth: 1, label: 'Child', x: 0, y: 0, color: '#fff' };
    const tooFar = applyChildDrag(
      bubble, 500, 0, 0, 0, { x: 0, y: 0 }, { minD: 50, maxD: 150 },
    );
    expect(tooFar.radial).toBe(1);

    const tooClose = applyChildDrag(
      bubble, 10, 0, 0, 0, { x: 0, y: 0 }, { minD: 50, maxD: 150 },
    );
    expect(tooClose.radial).toBe(0);
  });
});

// H1 — regression coverage for the bubble-drag freeze: the rAF loop skipped
// MotionValue writes for the ENTIRE gesture because a bubble drag registers a
// pointer in the same map a camera pan checks, so "any pointer active" gated
// off writes during a drag too. The fix must skip writes only while panning
// (a pointer active AND no bubble being dragged), never while a drag is live.
describe('shouldWriteBubbleMotionValues', () => {
  it('writes when idle (no pointers, no drag)', () => {
    expect(shouldWriteBubbleMotionValues(0, null)).toBe(true);
  });

  it('skips writes during a single-finger pan (pointer active, nothing being dragged)', () => {
    expect(shouldWriteBubbleMotionValues(1, null)).toBe(false);
  });

  it('skips writes during a two-finger pinch', () => {
    expect(shouldWriteBubbleMotionValues(2, null)).toBe(false);
  });

  it('writes throughout a bubble drag even though a pointer is registered', () => {
    expect(shouldWriteBubbleMotionValues(1, 'b3')).toBe(true);
  });

  it('writes even if a second pointer joins mid-drag', () => {
    // onBubbleMove hands off to the pinch handler when a second finger joins,
    // but draggingRef is not cleared until pointer-up — writes for the
    // (now-frozen) dragged bubble must still be permitted, not re-gated off.
    expect(shouldWriteBubbleMotionValues(2, 'b3')).toBe(true);
  });
});

// M1 — regression coverage for "can't pan while focused": stepOut() used to
// fire unconditionally on pointer-down, so the first pixel of a pan-drag was
// indistinguishable from a tap. isBackgroundTap must recognise a real tap
// (little movement, released quickly) while rejecting anything that moved
// far, took too long, or ever involved a second finger.
describe('isBackgroundTap', () => {
  it('is a tap: released quickly with negligible movement', () => {
    expect(isBackgroundTap(100, 100, 0, 102, 101, 50, false)).toBe(true);
  });

  it('is NOT a tap: moved far — this is a pan', () => {
    expect(isBackgroundTap(100, 100, 0, 250, 180, 50, false)).toBe(false);
  });

  it('is NOT a tap: held past the duration threshold even without moving', () => {
    expect(isBackgroundTap(100, 100, 0, 100, 100, 500, false)).toBe(false);
  });

  it('is NOT a tap: gesture involved a second finger (became a pinch)', () => {
    expect(isBackgroundTap(100, 100, 0, 101, 100, 30, true)).toBe(false);
  });

  it('respects custom distance/duration thresholds', () => {
    expect(isBackgroundTap(0, 0, 0, 5, 0, 100, false, 20, 200)).toBe(true);
    expect(isBackgroundTap(0, 0, 0, 5, 0, 100, false, 3, 200)).toBe(false);
  });
});

// L9 — descendantsOf was rewritten from an O(n·depth) fixed-point re-scan to a
// single parent→children map build + one traversal. These tests pin down the
// exact same semantics the old implementation had (id itself excluded, every
// transitive descendant included, order-independent as a Set) so the
// rewrite's correctness — not just its speed — is covered.
describe('descendantsOf', () => {
  const b = (id: string, parentId?: string): BubbleData =>
    ({ id, parentId, depth: parentId ? 1 : 0, label: id, x: 0, y: 0, color: '#fff' });

  it('returns an empty set for a leaf bubble', () => {
    const bubbles = [b('root'), b('child', 'root')];
    expect(descendantsOf(bubbles, 'child')).toEqual(new Set());
  });

  it('returns direct children only when there are no grandchildren', () => {
    const bubbles = [b('root'), b('c1', 'root'), b('c2', 'root')];
    expect(descendantsOf(bubbles, 'root')).toEqual(new Set(['c1', 'c2']));
  });

  it('includes deep transitive descendants but never the id itself', () => {
    const bubbles = [
      b('root'), b('c1', 'root'), b('gc1', 'c1'), b('ggc1', 'gc1'),
    ];
    const result = descendantsOf(bubbles, 'root');
    expect(result).toEqual(new Set(['c1', 'gc1', 'ggc1']));
    expect(result.has('root')).toBe(false);
  });

  it('only descends the requested branch, not unrelated siblings', () => {
    const bubbles = [
      b('root'), b('a', 'root'), b('b', 'root'), b('a1', 'a'), b('b1', 'b'),
    ];
    expect(descendantsOf(bubbles, 'a')).toEqual(new Set(['a1']));
  });

  it('handles a chain at MAX_DEPTH without missing the deepest node', () => {
    const bubbles = [b('d0')];
    for (let i = 1; i <= 10; i++) bubbles.push(b(`d${i}`, `d${i - 1}`));
    const result = descendantsOf(bubbles, 'd0');
    expect(result.size).toBe(10);
    expect(result.has('d10')).toBe(true);
  });

  it('does not infinite-loop on a cyclic parent chain', () => {
    // isValidBubbleGraph rejects cycles before anything reaches app state, but
    // descendantsOf must still fail safe rather than hang if one slipped
    // through. In a mutual a<->b cycle, both are reachable descendants of the
    // other by graph traversal — what matters here is that the `ids.has(cur)`
    // guard stops the walk (a genuinely infinite loop would time out this test).
    const bubbles = [b('a', 'b'), b('b', 'a')];
    const result = descendantsOf(bubbles, 'a');
    expect(result).toEqual(new Set(['a', 'b']));
  });
});
