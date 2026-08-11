/**
 * Mobile layout maths.
 *
 * This is the half of the codebase that decides where every bubble ends up,
 * and it was completely untested. It also has to agree with the web app's
 * copy: a child's position is stored as angle + a fraction of a leash band, so
 * if the two platforms disagree about that band, a bubble dragged on one
 * device lands somewhere else on the other — with no error to show for it.
 */
import { describe, expect, it } from 'vitest';
import {
  ringRadius, radialBand, deriveAngleRadial, canonicalChildPosition,
  syncPositionsFromAngleRadial, canvasSignature, relativeLayer,
  getAllDescendants, buildInitialBubbles, sizeForDepth, resolveCollisions,
  SCALE_MIN, SCALE_MAX, SCALE_OPTIONS, getSize,
} from './bubbleLayout';
import type { BubbleData } from './bubbleTypes';

const bubble = (over: Partial<BubbleData> & Pick<BubbleData, 'id'>): BubbleData => ({
  label: over.id, x: 0, y: 0, color: '#aaa', depth: 0, ...over,
});

// ─── Ring geometry ────────────────────────────────────────────────────────────

describe('ringRadius', () => {
  it('places a lone child just clear of its parent', () => {
    expect(ringRadius(100, 20, 1)).toBe(132); // 100 + 20 + 12
  });

  it('grows the ring as siblings are added, so they cannot overlap', () => {
    // A small parent with large children — the case where the angular spacing
    // term dominates. (With a large parent, the touching distance wins for any
    // realistic sibling count and the ring is flat.)
    expect(ringRadius(20, 40, 20)).toBeGreaterThan(ringRadius(20, 40, 3));
  });

  it('is driven by the touching distance when the parent dwarfs its children', () => {
    expect(ringRadius(200, 10, 3)).toBe(ringRadius(200, 10, 8));
  });

  it('never returns less than the touching distance, however many siblings', () => {
    for (const n of [1, 2, 5, 20, 100]) {
      expect(ringRadius(100, 20, n)).toBeGreaterThanOrEqual(132);
    }
  });
});

// ─── Scale awareness ──────────────────────────────────────────────────────────
//
// A bubble's manual scale has to reach the GEOMETRY, not just the rendering.
// When it only reached the rendering, enlarging a parent left its children
// resolving to positions inside it, and enlarging a child pushed it through its
// siblings — and because both platforms shared the blind spot, syncing
// propagated the overlap instead of revealing it.

describe('getSize', () => {
  it('multiplies the depth size by the bubble’s manual scale', () => {
    const base = sizeForDepth(1);
    expect(getSize(bubble({ id: 'a', depth: 1 }))).toBeCloseTo(base, 6);
    expect(getSize(bubble({ id: 'b', depth: 1, scale: 2 }))).toBeCloseTo(base * 2, 6);
    expect(getSize(bubble({ id: 'c', depth: 1, scale: 0.5 }))).toBeCloseTo(base * 0.5, 6);
  });

  it('clamps a scale outside the range the UI offers', () => {
    const base = sizeForDepth(1);
    expect(getSize(bubble({ id: 'big', depth: 1, scale: 99 }))).toBeCloseTo(base * SCALE_MAX, 6);
    expect(getSize(bubble({ id: 'tiny', depth: 1, scale: -5 }))).toBeCloseTo(base * SCALE_MIN, 6);
  });
});

describe('ringRadius clears the largest sibling', () => {
  it('grows the ring when one sibling is scaled up', () => {
    const uniform = ringRadius(50, 20, 6);
    const mixed   = ringRadius(50, 20, 6, 60);   // a much larger neighbour
    expect(mixed).toBeGreaterThan(uniform);
  });

  it('is unchanged when every sibling is the same size', () => {
    expect(ringRadius(50, 20, 6, 20)).toBe(ringRadius(50, 20, 6));
  });

  it('never returns less than the plain uniform ring', () => {
    for (const maxR of [1, 20, 200]) {
      expect(ringRadius(50, 20, 6, maxR)).toBeGreaterThanOrEqual(ringRadius(50, 20, 6));
    }
  });
});

describe('a scaled parent pushes its children clear of itself', () => {
  it('seats a child further out when the parent is enlarged', () => {
    const child = bubble({ id: 'c', parentId: 'p', depth: 1, angle: 0, radial: 0 });
    const near = canonicalChildPosition(child, bubble({ id: 'p', x: 0, y: 0, depth: 0 }), 0, 1);
    const far  = canonicalChildPosition(child, bubble({ id: 'p', x: 0, y: 0, depth: 0, scale: 2 }), 0, 1);
    expect(far.x).toBeGreaterThan(near.x);
  });

  // radial 0 means "touching the parent" — the closest the leash allows. Even
  // there the child must sit outside the parent's edge, or it renders inside it.
  it('keeps a child outside the parent’s edge at radial 0, however the two are scaled', () => {
    for (const [ps, cs] of [[1, 1], [2, 1], [1, 2], [2, 2], [0.5, 2]] as const) {
      const parent = bubble({ id: 'p', x: 0, y: 0, depth: 0, scale: ps });
      const child  = bubble({ id: 'c', parentId: 'p', depth: 1, scale: cs, angle: 0, radial: 0 });
      const pos = canonicalChildPosition(child, parent, 0, 1);
      const centreDistance = Math.hypot(pos.x - parent.x, pos.y - parent.y);
      const edgeToEdge = centreDistance - getSize(parent) / 2 - getSize(child) / 2;
      expect(edgeToEdge).toBeGreaterThan(0);
    }
  });
});

describe('radialBand', () => {
  it('brackets the natural resting distance between the leash ends', () => {
    const band = radialBand(160, 66, 4);
    expect(band.minD).toBeLessThanOrEqual(band.natural);
    expect(band.natural).toBeLessThan(band.maxD);
  });

  it('always leaves a usable span, even for a tiny parent', () => {
    const band = radialBand(9, 9, 1);
    expect(band.maxD - band.minD).toBeGreaterThan(0);
  });
});

describe('deriveAngleRadial', () => {
  it('is the inverse of walking angle/radial back out to x/y', () => {
    const band = radialBand(160, 66, 4);
    const angle = 0.9;
    const radial = 0.35;
    const r = band.minD + (band.maxD - band.minD) * radial;
    const x = 500 + Math.cos(angle) * r;
    const y = 300 + Math.sin(angle) * r;

    const derived = deriveAngleRadial(x, y, 500, 300, band);
    expect(derived.angle).toBeCloseTo(angle, 6);
    expect(derived.radial).toBeCloseTo(radial, 6);
  });

  it('clamps a bubble dragged past the end of its leash to 1', () => {
    const band = radialBand(160, 66, 4);
    const far = deriveAngleRadial(500 + band.maxD * 4, 300, 500, 300, band);
    expect(far.radial).toBe(1);
  });

  it('clamps a bubble dragged inside its parent to 0', () => {
    const band = radialBand(160, 66, 4);
    const near = deriveAngleRadial(501, 300, 500, 300, band);
    expect(near.radial).toBe(0);
  });

  // Dropping a child exactly on its parent gives a zero-length vector. Without
  // the `|| 1` guard this divides by zero and puts NaN into a coordinate —
  // the failure that poisons storage and the shared map alike.
  it('produces finite numbers when a child is dropped exactly on its parent', () => {
    const band = radialBand(160, 66, 4);
    const same = deriveAngleRadial(500, 300, 500, 300, band);
    expect(Number.isFinite(same.angle)).toBe(true);
    expect(Number.isFinite(same.radial)).toBe(true);
  });
});

// ─── Position derivation ──────────────────────────────────────────────────────

describe('canonicalChildPosition', () => {
  const parent = bubble({ id: 'p', x: 100, y: 100, depth: 0 });

  it('honours a stored angle/radial exactly', () => {
    const child = bubble({ id: 'c', parentId: 'p', depth: 1, angle: 0, radial: 0 });
    const pos = canonicalChildPosition(child, parent, 0, 1);
    const band = radialBand(sizeForDepth(0) / 2, sizeForDepth(1) / 2, 1);
    expect(pos.x).toBeCloseTo(100 + band.minD, 6);
    expect(pos.y).toBeCloseTo(100, 6);
  });

  it('derives the angle from x/y for a bubble that has never been dragged', () => {
    const child = bubble({ id: 'c', parentId: 'p', depth: 1, x: 100, y: 400 });
    const pos = canonicalChildPosition(child, parent, 0, 1);
    // Straight below the parent → angle of +pi/2.
    expect(pos.angle).toBeCloseTo(Math.PI / 2, 6);
  });

  it('fans siblings apart when neither angle nor a distinct position exists', () => {
    const a = bubble({ id: 'a', parentId: 'p', depth: 1, x: 100, y: 100 });
    const b = bubble({ id: 'b', parentId: 'p', depth: 1, x: 100, y: 100 });
    const pa = canonicalChildPosition(a, parent, 0, 2);
    const pb = canonicalChildPosition(b, parent, 1, 2);
    expect(pa.angle).not.toBeCloseTo(pb.angle, 3);
  });
});

describe('syncPositionsFromAngleRadial', () => {
  it('returns the SAME array reference when nothing needs moving', () => {
    // Identity matters: the caller feeds this into setState, and a fresh array
    // every time would re-render the whole canvas on every cloud poll.
    const settled = syncPositionsFromAngleRadial([
      bubble({ id: 'r', x: 0, y: 0 }),
    ]);
    const again = syncPositionsFromAngleRadial(settled);
    expect(again).toBe(settled);
  });

  it('leaves roots untouched — they have no parent to orbit', () => {
    const roots = [bubble({ id: 'r1', x: 5, y: 7 }), bubble({ id: 'r2', x: -30, y: 12 })];
    const out = syncPositionsFromAngleRadial(roots);
    expect(out[0]).toMatchObject({ x: 5, y: 7 });
    expect(out[1]).toMatchObject({ x: -30, y: 12 });
  });

  it('repositions a child whose stored x/y contradicts its angle/radial', () => {
    // Exactly what arrives from the web client, which stops writing x/y back
    // after the first drag and relies on angle/radial as the truth.
    const out = syncPositionsFromAngleRadial([
      bubble({ id: 'p', x: 0, y: 0, depth: 0 }),
      bubble({ id: 'c', parentId: 'p', depth: 1, x: 9999, y: 9999, angle: 0, radial: 0 }),
    ]);
    const child = out.find(b => b.id === 'c')!;
    expect(child.x).toBeLessThan(9999);
    expect(child.y).toBeCloseTo(0, 6);
  });

  it('positions a grandchild against its parent’s corrected position, not its stale one', () => {
    const out = syncPositionsFromAngleRadial([
      bubble({ id: 'p',  x: 0, y: 0, depth: 0 }),
      bubble({ id: 'c',  parentId: 'p', depth: 1, x: 9999, y: 0, angle: 0, radial: 0 }),
      bubble({ id: 'gc', parentId: 'c', depth: 2, x: 9999, y: 0, angle: 0, radial: 0 }),
    ]);
    const child = out.find(b => b.id === 'c')!;
    const grand = out.find(b => b.id === 'gc')!;
    const band = radialBand(sizeForDepth(1) / 2, sizeForDepth(2) / 2, 1);
    expect(grand.x).toBeCloseTo(child.x + band.minD, 6);
  });

  it('produces only finite coordinates', () => {
    const out = syncPositionsFromAngleRadial([
      bubble({ id: 'p', x: 0, y: 0, depth: 0 }),
      bubble({ id: 'c', parentId: 'p', depth: 1, x: 0, y: 0 }),
    ]);
    for (const b of out) {
      expect(Number.isFinite(b.x)).toBe(true);
      expect(Number.isFinite(b.y)).toBe(true);
    }
  });
});

// ─── Content signature ────────────────────────────────────────────────────────

describe('canvasSignature', () => {
  const base = [
    bubble({ id: 'b', label: 'B', x: 10, y: 20, depth: 1, parentId: 'a', angle: 1, radial: 0.5 }),
    bubble({ id: 'a', label: 'A', x: 0, y: 0 }),
  ];

  it('is stable across array order — reordering is not an edit', () => {
    expect(canvasSignature(base)).toBe(canvasSignature([...base].reverse()));
  });

  it.each([
    ['a label change',  (bs: BubbleData[]) => bs.map(b => b.id === 'a' ? { ...b, label: 'A2' } : b)],
    ['a colour change', (bs: BubbleData[]) => bs.map(b => b.id === 'a' ? { ...b, color: '#fff' } : b)],
    ['a move',          (bs: BubbleData[]) => bs.map(b => b.id === 'b' ? { ...b, x: 999 } : b)],
    ['a reparent',      (bs: BubbleData[]) => bs.map(b => b.id === 'b' ? { ...b, parentId: undefined } : b)],
    ['a deletion',      (bs: BubbleData[]) => bs.slice(1)],
    ['an addition',     (bs: BubbleData[]) => [...bs, bubble({ id: 'c' })]],
  ])('changes for %s', (_label, mutate) => {
    expect(canvasSignature(mutate(base))).not.toBe(canvasSignature(base));
  });

  it('changes when only the canvas name changes', () => {
    expect(canvasSignature(base, 'One')).not.toBe(canvasSignature(base, 'Two'));
  });

  // Sub-pixel drift is not an unsaved change: the drift/collision loop nudges
  // coordinates continuously, and a signature sensitive to that would leave
  // the unsaved dot permanently lit no matter how often the user saved.
  it('ignores sub-pixel drift', () => {
    const drifted = base.map(b => ({ ...b, x: b.x + 0.4 }));
    expect(canvasSignature(drifted)).toBe(canvasSignature(base));
  });
});

// ─── Tree helpers ─────────────────────────────────────────────────────────────

describe('getAllDescendants', () => {
  const tree = [
    bubble({ id: 'r' }),
    bubble({ id: 'a', parentId: 'r', depth: 1 }),
    bubble({ id: 'b', parentId: 'r', depth: 1 }),
    bubble({ id: 'a1', parentId: 'a', depth: 2 }),
    bubble({ id: 'a1x', parentId: 'a1', depth: 3 }),
  ];

  it('collects every level below a bubble, not just its direct children', () => {
    expect(getAllDescendants('a', tree).sort()).toEqual(['a1', 'a1x']);
  });

  it('returns nothing for a leaf', () => {
    expect(getAllDescendants('a1x', tree)).toEqual([]);
  });

  it('does not include the bubble itself', () => {
    expect(getAllDescendants('r', tree)).not.toContain('r');
  });
});

describe('relativeLayer', () => {
  const tree = [
    bubble({ id: 'r' }),
    bubble({ id: 'a', parentId: 'r', depth: 1 }),
    bubble({ id: 'a1', parentId: 'a', depth: 2 }),
  ];
  const byId = Object.fromEntries(tree.map(b => [b.id, b]));

  it('reads absolute depth in the unfocused overview', () => {
    expect(relativeLayer('r', null, byId)).toBe(0);
    expect(relativeLayer('a', null, byId)).toBe(1);
    expect(relativeLayer('a1', null, byId)).toBe(2);
  });

  it('puts the focused bubble on layer 0 and its children below it', () => {
    expect(relativeLayer('a', 'a', byId)).toBe(0);
    expect(relativeLayer('a1', 'a', byId)).toBe(1);
  });

  // -1 means "outside the three-layer view", which is what hides a bubble
  // entirely — getBubbleDisplaySize returns 0 for it.
  it('returns -1 for anything deeper than the third layer', () => {
    const deep = [...tree, bubble({ id: 'a1x', parentId: 'a1', depth: 3 })];
    const deepById = Object.fromEntries(deep.map(b => [b.id, b]));
    expect(relativeLayer('a1x', null, deepById)).toBe(-1);
    // Three levels below the focus is also out of view — but note that the
    // layers are relative: focusing 'a' brings the same bubble back to layer 2.
    expect(relativeLayer('a1x', 'r', deepById)).toBe(-1);
    expect(relativeLayer('a1x', 'a', deepById)).toBe(2);
  });

  it('returns -1 for an id that is not in the map at all', () => {
    expect(relativeLayer('ghost', null, byId)).toBe(-1);
  });
});

// ─── Collisions ───────────────────────────────────────────────────────────────

describe('resolveCollisions', () => {
  it('pushes overlapping bubbles apart until they clear each other', () => {
    const overlapping = [
      bubble({ id: 'x', x: 0, y: 0 }),
      bubble({ id: 'y', x: 30, y: 0 }),
    ];
    const byId = Object.fromEntries(overlapping.map(b => [b.id, b]));
    const moved = resolveCollisions(overlapping, null, byId, null, 8);

    const merged = overlapping.map(b => moved[b.id] ? { ...b, ...moved[b.id] } : b);
    const dist = Math.hypot(merged[0].x - merged[1].x, merged[0].y - merged[1].y);
    expect(dist).toBeGreaterThan(30);
  });

  it('holds the dragged bubble still and moves the other one out of its way', () => {
    const overlapping = [
      bubble({ id: 'held', x: 0, y: 0 }),
      bubble({ id: 'shoved', x: 30, y: 0 }),
    ];
    const byId = Object.fromEntries(overlapping.map(b => [b.id, b]));
    const moved = resolveCollisions(overlapping, null, byId, 'held', 8);

    expect(moved['held']).toBeUndefined();
    expect(moved['shoved']).toBeDefined();
  });

  // Exactly co-located bubbles have no separation direction to push along. The
  // `|| 0.01` distance guard means this stays finite rather than producing NaN
  // — which is the property that matters, since a NaN here would propagate
  // into storage and the shared map.
  it('stays finite when two bubbles occupy the identical point', () => {
    const stacked = [
      bubble({ id: 'x', x: 0, y: 0 }),
      bubble({ id: 'y', x: 0, y: 0 }),
    ];
    const byId = Object.fromEntries(stacked.map(b => [b.id, b]));
    for (const pos of Object.values(resolveCollisions(stacked, null, byId, null, 8))) {
      expect(Number.isFinite(pos.x)).toBe(true);
      expect(Number.isFinite(pos.y)).toBe(true);
    }
  });

  it('leaves well-separated bubbles alone', () => {
    const apart = [
      bubble({ id: 'x', x: -5000, y: 0 }),
      bubble({ id: 'y', x: 5000, y: 0 }),
    ];
    const byId = Object.fromEntries(apart.map(b => [b.id, b]));
    expect(Object.keys(resolveCollisions(apart, null, byId, null, 8))).toHaveLength(0);
  });

  it('ignores bubbles outside the three-layer view', () => {
    // Depth 3 is not rendered at all in the overview, so it must not push
    // anything around — its display size is 0.
    const tree = [
      bubble({ id: 'r' }),
      bubble({ id: 'a', parentId: 'r', depth: 1, x: 0, y: 0 }),
      bubble({ id: 'a1', parentId: 'a', depth: 2, x: 0, y: 0 }),
      bubble({ id: 'deep', parentId: 'a1', depth: 3, x: 0, y: 0 }),
    ];
    const byId = Object.fromEntries(tree.map(b => [b.id, b]));
    expect(resolveCollisions(tree, null, byId, null, 8)['deep']).toBeUndefined();
  });
});

// ─── Seed map and scale options ───────────────────────────────────────────────

describe('buildInitialBubbles', () => {
  const initial = buildInitialBubbles();

  it('produces a valid graph: unique ids and no orphans', () => {
    const ids = new Set(initial.map(b => b.id));
    expect(ids.size).toBe(initial.length);
    for (const b of initial) {
      if (b.parentId) expect(ids.has(b.parentId)).toBe(true);
    }
  });

  it('gives every bubble finite coordinates', () => {
    for (const b of initial) {
      expect(Number.isFinite(b.x)).toBe(true);
      expect(Number.isFinite(b.y)).toBe(true);
    }
  });

  it('returns a fresh array each call, so one canvas cannot mutate another', () => {
    expect(buildInitialBubbles()).not.toBe(initial);
  });
});

describe('SCALE_OPTIONS', () => {
  it('spans the full allowed range', () => {
    expect(SCALE_OPTIONS[0]).toBeCloseTo(SCALE_MIN, 6);
    expect(SCALE_OPTIONS[SCALE_OPTIONS.length - 1]).toBeCloseTo(SCALE_MAX, 6);
  });

  it('is strictly increasing with no floating-point duplicates', () => {
    for (let i = 1; i < SCALE_OPTIONS.length; i++) {
      expect(SCALE_OPTIONS[i]).toBeGreaterThan(SCALE_OPTIONS[i - 1]);
    }
  });
});
