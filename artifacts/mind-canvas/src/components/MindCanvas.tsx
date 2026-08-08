import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { motion, useMotionValue, animate, motionValue, type MotionValue } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────
// Everything on the canvas is a bubble. There is no "content" — a note, an item,
// a sub-task are all just bubbles nested one level deeper.

interface BubbleData {
  id:        string;
  parentId?: string;
  label:     string;
  x:         number;
  y:         number;
  color:     string;
  depth:     number;   // 0 = root pillar … up to MAX_DEPTH

  // Where a child sits relative to its parent. Stored separately from x/y
  // because x/y are laid out in ABSOLUTE-depth world units, which bear no
  // relation to the rendered ring once you are standing inside a deep bubble.
  //   angle  — radians around the parent
  //   radial — 0 = touching the parent, 1 = at the end of its leash
  // Both are optional; a bubble that has never been dragged uses the natural
  // ring position derived from its siblings.
  angle?:    number;
  radial?:   number;

  // Manual size, as a multiplier of whatever its current layer's base size is
  // (1 = 100%). Layer-relative rather than absolute, so "120%" means the same
  // thing — a fifth bigger than its peers — at every depth. Undefined = 100%.
  scale?:    number;
}

const MAX_DEPTH = 10;
const GAP       = 9;   // minimum breathing room between any two bubbles

// ─── Sizes ────────────────────────────────────────────────────────────────────
// Stored world sizes stay purely depth-driven — they only ever seed the initial
// coordinates. What is actually DRAWN is decided by `computeSizes` below.

const DEPTH_SIZE = [320, 166, 112, 84, 68, 58, 52, 47, 43, 40, 37];

function sizeForDepth(depth: number): number {
  return DEPTH_SIZE[Math.min(depth, DEPTH_SIZE.length - 1)];
}
function getSize(b: BubbleData): number {
  return sizeForDepth(b.depth);
}

// Only ever three layers are on screen, so on-screen size STARTS from the
// RELATIVE layer, never from absolute depth. That is what makes depth 8 read
// and behave exactly like depth 1 once you are standing inside it. The bubble's
// own manual scale is the only thing applied on top.
const LAYER_SIZE_OVERVIEW = [320, 166, 18];
const LAYER_SIZE_FOCUSED  = [250, 132, 16];

// ─── Manual size ──────────────────────────────────────────────────────────────
// Size is set by hand, never inferred from how much a bubble contains.

const SCALE_MIN  = 0.1;
const SCALE_MAX  = 2.0;
const SCALE_STEP = 0.1;

const SCALE_OPTIONS = Array.from(
  { length: Math.round((SCALE_MAX - SCALE_MIN) / SCALE_STEP) + 1 },
  (_, i) => Math.round((SCALE_MIN + i * SCALE_STEP) * 10) / 10,
);

function bubbleScale(b: BubbleData): number {
  const s = b.scale ?? 1;
  return Math.min(Math.max(s, SCALE_MIN), SCALE_MAX);
}

function relativeLayer(id: string, focusedId: string | null, byId: Record<string, BubbleData>): number {
  if (!focusedId) return byId[id]?.depth ?? 0;
  if (id === focusedId) return 0;
  let current = byId[id];
  let distance = 0;
  while (current?.parentId) {
    distance += 1;
    if (current.parentId === focusedId) return distance;
    current = byId[current.parentId];
  }
  return -1;
}

function isInThreeLayerView(bubble: BubbleData, focusedId: string | null, byId: Record<string, BubbleData>) {
  const layer = relativeLayer(bubble.id, focusedId, byId);
  return layer >= 0 && layer <= 2;
}

// Rendered diameter for everything currently on screen: the layer's base size
// times the bubble's own manual scale. Layer-2 indicator dots stay a fixed pip.
//
// Nothing is clamped against the parent — a size the user picked by hand must
// come out at exactly the percentage they picked, even if that makes a child
// larger than what it sits inside.
function computeSizes(
  ordered: BubbleData[],
  layerOf: (b: BubbleData) => number,
  focusedId: string | null,
): Record<string, number> {
  const table = focusedId ? LAYER_SIZE_FOCUSED : LAYER_SIZE_OVERVIEW;
  const size: Record<string, number> = {};

  for (const b of ordered) {
    const layer = Math.min(Math.max(layerOf(b), 0), 2);
    size[b.id] = layer === 2 ? table[2] : table[layer] * bubbleScale(b);
  }
  return size;
}

// Everything the view needs about *who is on screen and how big they are*.
// Shared by the animation loop, the camera and the renderer so all three agree.
interface ViewSizes {
  allMap:  Record<string, BubbleData>;
  layerOf: (b: BubbleData) => number;
  ordered: BubbleData[];
  visible: Record<string, BubbleData>;
  sizes:   Record<string, number>;
}

function viewSizes(all: BubbleData[], focusedId: string | null): ViewSizes {
  const allMap  = Object.fromEntries(all.map(b => [b.id, b]));
  const layerOf = (b: BubbleData) => relativeLayer(b.id, focusedId, allMap);
  const ordered = all
    .filter(b => isInThreeLayerView(b, focusedId, allMap))
    .sort((a, b) => layerOf(a) - layerOf(b));
  const visible = Object.fromEntries(ordered.map(b => [b.id, b]));
  const sizes   = computeSizes(ordered, layerOf, focusedId);
  return { allMap, layerOf, ordered, visible, sizes };
}

// ─── Seed tree ────────────────────────────────────────────────────────────────

interface SeedNode { label: string; children?: SeedNode[] }

function deepTestBranch(level = 1): SeedNode {
  if (level > MAX_DEPTH) return { label: 'Test leaf' };
  return {
    label: level === 1 ? 'Depth Test' : `Level ${level}`,
    children: Array.from({ length: 4 }, (_, index) => (
      index === 0 && level < MAX_DEPTH
        ? deepTestBranch(level + 1)
        : { label: `L${level} · ${index + 1}` }
    )),
  };
}

const SEED: { label: string; color: string; children: SeedNode[] }[] = [
  {
    label: 'Career', color: 'hsl(250,60%,65%)',
    children: [
      { label: 'Visionary', children: [
        { label: '10-year vision' }, { label: 'Industry shifts' }, { label: 'Long game' },
      ]},
      { label: 'New Project', children: [
        { label: 'Kickoff brief' },
        { label: 'MVP scope', children: [
          { label: 'Auth flow' },
          { label: 'Core loop', children: [{ label: 'Edge cases' }] },
        ]},
        { label: 'Stakeholders' }, { label: 'Timeline' },
      ]},
      { label: 'Learning', children: [
        { label: 'TypeScript' }, { label: 'System design' }, { label: 'Writing clearly' },
      ]},
    ],
  },
  {
    label: 'Personal', color: 'hsl(340,60%,65%)',
    children: [
      { label: 'Fitness',  children: [{ label: 'Morning runs' }, { label: 'Zone 2' }, { label: 'Mobility' }, { label: 'Sleep' }] },
      { label: 'Reading',  children: [{ label: 'Deep Work' }, { label: 'Atomic Habits' }, { label: 'Backlog' }] },
      { label: 'Family',   children: [{ label: 'Sunday dinners' }, { label: 'Trip planning' }, { label: "Dad's birthday" }] },
    ],
  },
  {
    label: 'SSS', color: 'hsl(170,40%,55%)',
    children: [
      deepTestBranch(),
      { label: 'Event',     children: [{ label: 'Venue' }, { label: 'Speakers' }, { label: 'Catering' }, { label: 'Guest list' }] },
      { label: 'Planning',  children: [{ label: 'Q3 roadmap' }, { label: 'Budget' }, { label: 'Team' }] },
      { label: 'Marketing', children: [{ label: 'Brand refresh' }, { label: 'Social' }, { label: 'Partnerships' }] },
    ],
  },
];

// Ring radius that fits `n` circles of radius `cr` around a parent of radius `pr`
// without the siblings touching each other.
function ringRadius(pr: number, cr: number, n: number): number {
  const touching = pr + cr + GAP + cr * 0.55 + 12;
  if (n <= 1) return touching;
  const spacing = (cr + GAP / 2) / Math.sin(Math.PI / n);
  return Math.max(touching, spacing);
}

// The band a child may live in, measured in RENDERED radii:
//   minD    — touching its parent
//   natural — where it sits if it has never been dragged
//   maxD    — the end of its leash
// One definition, used by the layout, the drag and the collision solver, so
// none of them can pull a bubble back out of where another put it.
function radialBand(pr: number, cr: number, n: number) {
  const minD    = pr + cr + GAP;
  const natural = ringRadius(pr, cr, n);
  const maxD    = Math.max(natural + Math.max(40, pr * 0.9), minD + Math.max(48, pr * 1.6));
  return { minD, maxD, natural };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function buildBubbles(): BubbleData[] {
  const out: BubbleData[] = [];
  let counter = 0;

  const addKids = (parent: BubbleData, kids: SeedNode[] | undefined, awayAngle: number) => {
    if (!kids?.length) return;
    const depth = parent.depth + 1;
    if (depth > MAX_DEPTH) return;
    const pr = sizeForDepth(parent.depth) / 2;
    const cr = sizeForDepth(depth) / 2;
    const n  = kids.length;
    const R  = ringRadius(pr, cr, n);
    // Root's children spread over a full circle; deeper levels fan away from
    // the grandparent so they never sweep back through it.
    const fullCircle = parent.depth === 0;
    const arc  = fullCircle ? Math.PI * 2 : Math.PI * 1.1;
    const step = fullCircle ? arc / n : arc / Math.max(n, 2);

    kids.forEach((k, i) => {
      const angle = fullCircle
        ? awayAngle + i * step
        : awayAngle + (i - (n - 1) / 2) * step;
      const child: BubbleData = {
        id: `b${counter++}`,
        depth,
        parentId: parent.id,
        label: k.label,
        x: parent.x + Math.cos(angle) * R,
        y: parent.y + Math.sin(angle) * R,
        color: parent.color,
      };
      out.push(child);
      addKids(child, k.children, angle);
    });
  };

  SEED.forEach((root, i) => {
    const a = (i / SEED.length) * Math.PI * 2 - Math.PI / 2;
    const R = 620;
    const rootBubble: BubbleData = {
      id: `b${counter++}`,
      depth: 0,
      label: root.label,
      x: Math.cos(a) * R,
      y: Math.sin(a) * R,
      color: root.color,
    };
    out.push(rootBubble);
    addKids(rootBubble, root.children, a);
  });

  return out;
}

const INITIAL_BUBBLES = buildBubbles();

// ─── Persistence ──────────────────────────────────────────────────────────────
// State is saved to localStorage on every change so the mind map survives
// a page refresh or closing the browser. A version key means a future schema
// change can detect and discard stale saves instead of silently corrupting them.

const STORAGE_KEY     = 'mind-canvas-bubbles';
const STORAGE_VERSION = 1;

interface StoredState {
  version: number;
  bubbles: BubbleData[];
}

function loadBubbles(): BubbleData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_BUBBLES;
    const parsed: StoredState = JSON.parse(raw);
    if (parsed.version !== STORAGE_VERSION) return INITIAL_BUBBLES;
    if (!Array.isArray(parsed.bubbles) || parsed.bubbles.length === 0) return INITIAL_BUBBLES;
    return parsed.bubbles;
  } catch {
    return INITIAL_BUBBLES;
  }
}

function saveBubbles(bubbles: BubbleData[]): boolean {
  try {
    const state: StoredState = { version: STORAGE_VERSION, bubbles };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // Storage full or unavailable — caller decides how to surface this.
    return false;
  }
}

function clearBubbles(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ─── Collision solver ─────────────────────────────────────────────────────────
// Guarantees no two bubbles ever overlap, and every child stays in the ring
// between "touching its parent" and its maximum leash.
// Operates on rendered positions each frame; heavier (larger) bubbles move less.

function resolveCollisions(
  list: BubbleData[],
  byId: Record<string, BubbleData>,
  pos: Record<string, { x: number; y: number }>,
  immovableId: string | null,
  sizeOf: (b: BubbleData) => number,
  bandOf: (b: BubbleData) => { minD: number; maxD: number } | null,
  iterations = 6,
) {
  const n = list.length;

  for (let iter = 0; iter < iterations; iter++) {
    // 1 — pairwise separation
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = list[i], b = list[j];
        const pa = pos[a.id], pb = pos[b.id];
        if (!pa || !pb) continue;

        const ra = sizeOf(a) / 2, rb = sizeOf(b) / 2;
        const minSep = ra + rb + GAP;

        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        let d  = Math.hypot(dx, dy);
        if (d === 0) { dx = 0.7071; dy = 0.7071; d = 1; }   // identical points
        if (d >= minSep) continue;

        const overlap = minSep - d;
        const ux = dx / d, uy = dy / d;

        // Mass ∝ area, so big pillars barely budge and small bubbles yield.
        const ma = ra * ra, mb = rb * rb;
        const aFixed = a.id === immovableId;
        const bFixed = b.id === immovableId;

        let wa: number, wb: number;
        if (aFixed && bFixed)      { wa = 0;              wb = 0; }
        else if (aFixed)           { wa = 0;              wb = 1; }
        else if (bFixed)           { wa = 1;              wb = 0; }
        else                       { wa = mb / (ma + mb); wb = ma / (ma + mb); }

        pa.x -= ux * overlap * wa; pa.y -= uy * overlap * wa;
        pb.x += ux * overlap * wb; pb.y += uy * overlap * wb;
      }
    }

    // 2 — parent ring constraint, depth ascending so parents settle first
    for (const b of list) {
      if (!b.parentId) continue;
      const parent = byId[b.parentId];
      const pp = pos[b.parentId];
      const pb = pos[b.id];
      if (!parent || !pp || !pb) continue;

      // Exactly the band the layout used, so the solver can never drag a bubble
      // back out of the spot the user just put it in.
      const band = bandOf(b);
      if (!band) continue;
      const { minD, maxD } = band;

      let dx = pb.x - pp.x;
      let dy = pb.y - pp.y;
      let d  = Math.hypot(dx, dy);
      if (d === 0) { dx = 1; dy = 0; d = 1; }

      const clamped = Math.min(Math.max(d, minD), maxD);
      if (clamped !== d) {
        pb.x = pp.x + (dx / d) * clamped;
        pb.y = pp.y + (dy / d) * clamped;
      }
    }
  }
}

// ─── Float params ─────────────────────────────────────────────────────────────

function idHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h;
}

// Drift is keyed to the on-screen LAYER, not depth, so the amount of life a
// bubble shows depends on how big it currently reads — third-layer dots barely
// twitch, the layer you are inside breathes slowly.
//
// A child gets THREE independent motions, which is what makes the canvas read
// as alive rather than as a rigid diagram: free drift, a slow swing along its
// parent's ring, and a gentle in/out along its leash.
const LAYER_FLOAT_AMP  = [24, 18, 5];        // free drift, px
const LAYER_ORBIT_AMP  = [0, 0.085, 0.035];  // swing along the ring, radians
const LAYER_RADIAL_AMP = [0, 16, 4];         // breathing along the leash, px

const TAU = Math.PI * 2;

function getFloatParams(id: string, layer: number) {
  const h  = idHash(id);
  const h1 = ((h >> 0) & 0xff) / 255;
  const h2 = ((h >> 4) & 0xff) / 255;
  const h3 = ((h >> 8) & 0xff) / 255;
  const l  = Math.min(Math.max(layer, 0), 2);
  const amp = LAYER_FLOAT_AMP[l];
  return {
    freqX:  0.15 + h1 * .10,
    freqY:  0.12 + h2 * .09,
    ampX:   amp,
    ampY:   amp * .84,
    phaseX: h1 * TAU,
    phaseY: h3 * TAU,

    freqA:  0.09 + h2 * .06,
    ampA:   LAYER_ORBIT_AMP[l],
    phaseA: h2 * TAU,

    freqR:  0.11 + h3 * .07,
    ampR:   LAYER_RADIAL_AMP[l],
    phaseR: h1 * TAU + 1.7,
  };
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const ROOT_COLORS = [
  'hsl(250,60%,65%)', 'hsl(340,60%,65%)', 'hsl(170,40%,55%)',
  'hsl(40,65%,65%)',  'hsl(200,55%,60%)', 'hsl(290,50%,66%)',
];

// ─── View layout ──────────────────────────────────────────────────────────────
// The single source of truth for where the visible three layers sit. Both the
// animation loop and the camera use it, so the camera always frames exactly
// what will be drawn — including at deep levels, where the stored world
// coordinates bear no relation to the on-screen ring sizes.

interface ViewLayout {
  list:   BubbleData[];
  map:    Record<string, BubbleData>;
  pos:    Record<string, { x: number; y: number }>;
  sizeOf: (b: BubbleData) => number;
  bandOf: (b: BubbleData) => { minD: number; maxD: number } | null;
}

function layoutView(all: BubbleData[], focusedId: string | null, time: number | null): ViewLayout {
  const { allMap, layerOf, ordered: list, visible: map, sizes } = viewSizes(all, focusedId);
  const sizeOf = (b: BubbleData) =>
    sizes[b.id] ?? (relativeLayer(b.id, focusedId, allMap) < 0 ? getSize(b) : LAYER_SIZE_OVERVIEW[2]);

  // Sibling sets, so each ring can be sized to actually hold everyone on it.
  const rings: Record<string, string[]> = {};
  for (const b of list) {
    if (!b.parentId || !map[b.parentId]) continue;
    (rings[b.parentId] ??= []).push(b.id);
  }

  const bandOf = (b: BubbleData) => {
    const parent = b.parentId ? map[b.parentId] : null;
    if (!parent) return null;
    const ring = rings[parent.id] ?? [b.id];
    return radialBand(sizeOf(parent) / 2, sizeOf(b) / 2, ring.length);
  };

  // Layer 0 keeps its stored world position: roots (and the bubble you are
  // inside) are freely placeable. Layers 1 and 2 hang off their parent by an
  // ANGLE and a RADIAL fraction of the leash — both of which the user can drag,
  // and both of which are resolved against RENDERED sizes so a deep level
  // behaves exactly like a shallow one.
  const pos: Record<string, { x: number; y: number }> = {};
  const t = time ?? 0;
  const moving = time !== null;

  for (const b of list) {
    const layer  = layerOf(b);
    const p      = moving ? getFloatParams(b.id, layer) : null;
    const ownX   = p ? Math.cos(t * p.freqX + p.phaseX) * p.ampX : 0;
    const ownY   = p ? Math.sin(t * p.freqY + p.phaseY) * p.ampY : 0;

    const parent = b.parentId ? map[b.parentId] : null;
    const pp     = parent ? pos[parent.id] : null;

    if (!parent || !pp) {
      pos[b.id] = { x: b.x + ownX, y: b.y + ownY };
      continue;
    }

    const ring  = rings[parent.id] ?? [b.id];
    const index = Math.max(0, ring.indexOf(b.id));
    const dx = b.x - parent.x, dy = b.y - parent.y;
    // Explicit dragged angle wins; otherwise fall back to the seeded direction,
    // and finally to an even spread around the ring.
    let angle = b.angle ?? (Math.hypot(dx, dy) > 1
      ? Math.atan2(dy, dx)
      : (index / ring.length) * TAU - Math.PI / 2);

    const band = radialBand(sizeOf(parent) / 2, sizeOf(b) / 2, ring.length);
    const span = Math.max(1, band.maxD - band.minD);
    const home = b.radial ?? (band.natural - band.minD) / span;
    let r = band.minD + span * clamp01(home);

    if (p) {
      angle += Math.sin(t * p.freqA + p.phaseA) * p.ampA;   // swing along the ring
      r     += Math.sin(t * p.freqR + p.phaseR) * p.ampR;   // breathe in and out
      r      = Math.min(Math.max(r, band.minD), band.maxD);
    }

    pos[b.id] = {
      x: pp.x + Math.cos(angle) * r + ownX,
      y: pp.y + Math.sin(angle) * r + ownY,
    };
  }

  return { list, map, pos, sizeOf, bandOf };
}

// ─── Camera fit ───────────────────────────────────────────────────────────────

function fitLayout(
  layout: ViewLayout,
  cx: MotionValue<number>,
  cy: MotionValue<number>,
  cs: MotionValue<number>,
  opts: { maxScale?: number; padding?: number; spring?: boolean } = {},
) {
  const { list, pos, sizeOf } = layout;
  if (!list.length) return;
  const { maxScale = 2.4, padding = 120, spring = false } = opts;
  const xs = list.flatMap(b => {
    const p = pos[b.id]; const r = sizeOf(b) / 2;
    return p ? [p.x - r, p.x + r] : [];
  });
  const ys = list.flatMap(b => {
    const p = pos[b.id]; const r = sizeOf(b) / 2;
    return p ? [p.y - r, p.y + r] : [];
  });
  if (!xs.length) return;
  const minX = Math.min(...xs) - padding, maxX = Math.max(...xs) + padding;
  const minY = Math.min(...ys) - padding, maxY = Math.max(...ys) + padding;
  const scale = Math.min(
    window.innerWidth  / Math.max(1, maxX - minX),
    window.innerHeight / Math.max(1, maxY - minY),
    maxScale,
  );
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const cfg = spring
    ? { type: 'spring', stiffness: 120, damping: 22 } as const
    : { type: 'tween', duration: .3, ease: 'easeOut' } as const;
  animate(cx, window.innerWidth  / 2 - centerX * scale, cfg);
  animate(cy, window.innerHeight / 2 - centerY * scale, cfg);
  animate(cs, scale, cfg);
}

// ─── Glass bubble ─────────────────────────────────────────────────────────────

function GlassBubbleSVG({ size, color, label, isEditing, editValue, onEditChange, onEditSave, onEditCancel, onLabelClick }: {
  size: number; color: string; label: string;
  isEditing?: boolean; editValue?: string;
  onEditChange?: (v: string) => void; onEditSave?: () => void; onEditCancel?: () => void;
  onLabelClick?: () => void;
}) {
  const uid = (color + Math.round(size)).replace(/[^a-zA-Z0-9]/g, '');
  const fontSize = Math.max(size * 0.135, 8.5);
  // A rename must both START and END on the label. The second click of the
  // locking double-click presses down on the bubble (the label is inert until
  // the bubble is locked) and only lands on the label once the lock re-renders,
  // so requiring the press to originate here is what separates "lock" from
  // "rename" — a time window cannot tell those two gestures apart.
  const labelArmed = useRef(false);
  return (
    <div style={{ width: size, height: size }} className="relative rounded-full flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 pointer-events-none overflow-visible">
        <defs>
          <radialGradient id={`bg-${uid}`} cx="30%" cy="30%" r="70%">
            <stop offset="0%"   stopColor="#ffffff" stopOpacity=".92"/>
            <stop offset="42%"  stopColor={color} stopOpacity=".88"/>
            <stop offset="100%" stopColor={color} stopOpacity="1"/>
          </radialGradient>
          <radialGradient id={`rim-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="83%"  stopColor="#fff" stopOpacity="0"/>
            <stop offset="96%"  stopColor="#fff" stopOpacity=".88"/>
            <stop offset="100%" stopColor="#fff" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id={`spec-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#fff" stopOpacity=".92"/>
            <stop offset="28%"  stopColor="#fff" stopOpacity=".28"/>
            <stop offset="100%" stopColor="#fff" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id={`glow-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={color} stopOpacity=".72"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </radialGradient>
        </defs>
        <circle cx={size/2} cy={size/2} r={size/2-1} fill={`url(#bg-${uid})`}/>
        <circle cx={size/2} cy={size/2} r={size/2-1} fill={`url(#rim-${uid})`}/>
        <circle cx={size*.64} cy={size*.68} r={size*.38} fill={`url(#glow-${uid})`}/>
        <ellipse cx={size*.28} cy={size*.24} rx={size*.17} ry={size*.10}
          fill={`url(#spec-${uid})`} transform={`rotate(-40,${size*.28},${size*.24})`}/>
      </svg>

      {isEditing ? (
        <input autoFocus value={editValue ?? ''} onChange={e => onEditChange?.(e.target.value)}
          onBlur={onEditSave}
          onKeyDown={e => { if (e.key === 'Enter') onEditSave?.(); if (e.key === 'Escape') onEditCancel?.(); }}
          onPointerDown={e => e.stopPropagation()}
          className="relative z-20 bg-transparent text-center font-sans font-light text-gray-700 tracking-wide outline-none cursor-text select-text w-4/5"
          // iOS zooms into any input whose font-size is below 16px. Use the
          // bubble-derived size but clamp it up to 16px so the canvas never
          // involuntarily zooms the whole page on mobile.
          style={{ fontSize: Math.max(fontSize, 16), lineHeight: 1.15 }}/>
      ) : (
        <div className="relative z-10 text-gray-700 font-sans font-light tracking-wide select-none text-center break-words"
          style={{ pointerEvents: onLabelClick ? 'auto' : 'none', fontSize, lineHeight: 1.15, maxWidth: '84%' }}
          onPointerDown={onLabelClick
            ? e => { e.stopPropagation(); labelArmed.current = true; }
            : undefined}
          // The bubble's pointer-up handler must not run for a press that began
          // on the label: it never captured this pointer, and releasing an
          // uncaptured pointer throws.
          onPointerUp={onLabelClick ? e => e.stopPropagation() : undefined}
          onClick={onLabelClick
            ? () => { if (labelArmed.current) { labelArmed.current = false; onLabelClick(); } }
            : undefined}>
          {label}
        </div>
      )}
    </div>
  );
}

// ─── Procedural coordinate field ──────────────────────────────────────────────
// Inspired by the supplied drafting-grid reference, but made from live SVG so it
// lives in the same infinite coordinate system as bubbles and can move with them.

// Memoized — takes no props and never needs to re-render.
const CoordinateField = memo(function CoordinateField() {
  const worldSize = 7200;
  const half = worldSize / 2;
  const minor = 40;
  const major = 200;
  const minorLines = Array.from({ length: worldSize / minor + 1 }, (_, i) => -half + i * minor);
  const majorLines = Array.from({ length: worldSize / major + 1 }, (_, i) => -half + i * major);

  return (
    <svg
      aria-hidden="true"
      className="absolute pointer-events-none overflow-visible"
      style={{ left: -half, top: -half, width: worldSize, height: worldSize, zIndex: -1 }}
      viewBox={`${-half} ${-half} ${worldSize} ${worldSize}`}
    >
      <defs>
        <linearGradient id="field-wash" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eef0ee" stopOpacity=".95" />
          <stop offset=".55" stopColor="#f8f8f6" stopOpacity=".68" />
          <stop offset="1" stopColor="#e7e9e7" stopOpacity=".92" />
        </linearGradient>
        <radialGradient id="field-bloom" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fdfefd" stopOpacity=".85" />
          <stop offset=".65" stopColor="#f4f5f3" stopOpacity=".16" />
          <stop offset="1" stopColor="#e4e7e5" stopOpacity="0" />
        </radialGradient>
        <filter id="field-noise">
          <feTurbulence type="fractalNoise" baseFrequency=".014" numOctaves="2" seed="8" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer><feFuncA type="table" tableValues="0 .04" /></feComponentTransfer>
        </filter>
      </defs>

      <rect x={-half} y={-half} width={worldSize} height={worldSize} fill="url(#field-wash)" />
      <rect x={-half} y={-half} width={worldSize} height={worldSize} filter="url(#field-noise)" opacity=".35" />

      {/* Fine square grid */}
      <g stroke="#aab0ad" strokeWidth="1" opacity=".16">
        {minorLines.map(v => <line key={`vx${v}`} x1={v} y1={-half} x2={v} y2={half} />)}
        {minorLines.map(v => <line key={`hy${v}`} x1={-half} y1={v} x2={half} y2={v} />)}
      </g>

      {/* Major drafting grid */}
      <g stroke="#8c9691" strokeWidth="1.8" opacity=".34">
        {majorLines.map(v => <line key={`mx${v}`} x1={v} y1={-half} x2={v} y2={half} />)}
        {majorLines.map(v => <line key={`my${v}`} x1={-half} y1={v} x2={half} y2={v} />)}
      </g>

      {/* Strong zero axes: the canvas's actual (0,0), useful while navigating */}
      <g stroke="#6e7974" strokeWidth="2.2" opacity=".35">
        <line x1={0} y1={-half} x2={0} y2={half} />
        <line x1={-half} y1={0} x2={half} y2={0} />
      </g>

      {/* Coordinate stamps appear at every major intersection. */}
      <g fill="#77817c" opacity=".42" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="18">
        {majorLines.filter(v => Math.abs(v) < half - 140).flatMap(x =>
          majorLines.filter(v => Math.abs(v) < half - 140).map(y => (
            <text key={`label-${x}-${y}`} x={x + 10} y={y - 10}>{`${x / major}, ${-y / major}`}</text>
          )),
        )}
      </g>

      {/* A bright, gently animated coordinate bloom makes depth readable. */}
      <circle cx="0" cy="0" r="1080" fill="url(#field-bloom)" opacity=".8">
        <animate attributeName="r" values="980;1180;980" dur="11s" repeatCount="indefinite" />
        <animate attributeName="opacity" values=".6;.9;.6" dur="11s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
});

// Ring drawn around the bubble currently locked in edit mode.
const LOCK_RING = 'hsl(260,55%,58%)';

const PILLAR_COLORS = [
  'hsl(250,60%,58%)', 'hsl(340,64%,60%)', 'hsl(170,48%,46%)',
  'hsl(40,72%,55%)', 'hsl(205,62%,55%)', 'hsl(290,54%,60%)',
  'hsl(8,68%,57%)', 'hsl(120,42%,48%)',
];

function hslParts(color: string) {
  const match = color.match(/hsl\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function colorsAreClose(first: string, second: string) {
  const [h1, s1, l1] = hslParts(first);
  const [h2, s2, l2] = hslParts(second);
  const hueGap = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
  return hueGap < 24 && Math.abs(s1 - s2) < 22 && Math.abs(l1 - l2) < 20;
}

// Panel under the bubble currently locked in edit mode.
//
// Color behaves differently by level, deliberately:
//   pillar (depth 0) — the color IS the branch's identity, so it cascades to
//                      the whole subtree, and a near-duplicate is challenged.
//   depth 1+         — the color is that one bubble's own. It never touches its
//                      parent or its children, and needs no duplicate check.
function BubbleEditPanel({ color, scale, isPillar, inheritedColor, existingColors, onChoose, onScale, onResetColor }: {
  color: string;
  scale: number;
  isPillar: boolean;
  inheritedColor?: string;
  existingColors: string[];
  onChoose: (color: string) => void;
  onScale: (scale: number) => void;
  onResetColor?: () => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const choose = (next: string) => {
    if (isPillar && existingColors.some(used => colorsAreClose(used, next))) setPending(next);
    else onChoose(next);
  };

  return (
    <div className="absolute pointer-events-auto z-50"
      style={{
        top: 'calc(100% + 15px)',
        left: '50%',
        transform: 'translateX(-50%)',
        // Never overflow the viewport on narrow screens.
        width: 'min(240px, calc(100vw - 32px))',
      }}
      // Stop both ends of the press: the bubble underneath never captured this
      // pointer, so letting its pointer-up run would try to release one it does
      // not own.
      onPointerDown={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}>
      <div className="p-4"
        style={{ background: 'rgba(255,255,255,.94)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderRadius: 15, boxShadow: '0 8px 30px rgba(0,0,0,.12), inset 0 0 0 1px rgba(255,255,255,.95)' }}>
        {pending ? (
          <>
            <p className="text-sm leading-relaxed font-light text-gray-500">
              This color is very close to an existing pillar. Use it anyway?
            </p>
            <div className="flex gap-2 justify-end mt-3">
              {/* min 44px touch target via py-3 */}
              <button className="text-sm text-gray-400 px-4 py-3" onClick={() => setPending(null)}>Change</button>
              <button className="text-sm text-white rounded-full px-4 py-3" style={{ background: pending }}
                onClick={() => { onChoose(pending); setPending(null); }}>Use anyway</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs uppercase tracking-widest font-light text-gray-400">
                {isPillar ? 'Pillar color' : 'Bubble color'}
              </p>
              {!isPillar && onResetColor && inheritedColor && color !== inheritedColor && (
                // Wider tap target: negative margin keeps visual layout unchanged
                <button className="text-xs font-light text-gray-400 active:text-gray-600 px-2 py-2 -my-2 -mr-2"
                  onClick={onResetColor}>reset</button>
              )}
            </div>
            {/* 44px swatches fit 4-per-row in 240px panel */}
            <div className="grid grid-cols-4 gap-2">
              {PILLAR_COLORS.map(option => (
                <button key={option} aria-label={`Choose ${option}`} onClick={() => choose(option)}
                  className="rounded-full active:scale-95 transition-transform"
                  style={{ width: 44, height: 44, background: option, boxShadow: color === option ? '0 0 0 3px #fff, 0 0 0 5px rgba(90,90,100,.4)' : 'inset 0 1px 2px rgba(255,255,255,.5)' }} />
              ))}
            </div>

            <div className="mt-3.5 pt-3 border-t border-gray-100">
              <p className="text-xs uppercase tracking-widest font-light text-gray-400 mb-2">Size</p>
              <select
                value={String(Math.round(scale * 10) / 10)}
                onChange={e => onScale(Number(e.target.value))}
                className="w-full bg-transparent text-base font-light text-gray-600 outline-none cursor-pointer"
                style={{ border: '1px solid #e5e7eb', borderRadius: 9, padding: '10px 8px', minHeight: 44 }}>
                {SCALE_OPTIONS.map(option => (
                  <option key={option} value={String(option)}>{Math.round(option * 100)}%</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Add Panel — drill down the full tree, any depth ──────────────────────────

// The panel is anchored by its TOP, never its bottom. Bottom-anchoring was the
// bug behind "I click a parent and nothing happens": each level you open makes
// the panel taller, which shoved every row ~100px upward out from under the
// cursor, so the next click landed on whatever slid into that spot. Anchored at
// the top, new levels extend downward and the rows already on screen hold still.
const LIST_MAX_H = 'min(384px, 42vh)';

// Where that top sits: high enough that the panel at full height still clears
// the bottom of the window, but never off the top edge on a short window.
function panelTop(): number {
  const listMax = Math.min(384, window.innerHeight * 0.42);
  const chrome  = 200;   // title + label field + footer caption + buttons
  return Math.max(16, window.innerHeight - 80 - (listMax + chrome));
}

function AddPanel({ bubbles, onAdd, onClose, initialParentPath = [], quickCreate, anchor, onQuickSave, onQuickCancel }: {
  bubbles: BubbleData[];
  onAdd: (label: string, parentId: string | null, opts?: { color?: string; scale?: number }) => void;
  onClose: () => void;
  initialParentPath?: string[];
  quickCreate?: { id: string };
  anchor?: { x: number; y: number };
  onQuickSave?: (id: string, label: string, opts?: { color?: string; scale?: number }) => void;
  onQuickCancel?: () => void;
}) {
  const [label, setLabel]           = useState('');
  const [parentPath, setParentPath] = useState<string[]>(initialParentPath);

  const byId  = useMemo(() => Object.fromEntries(bubbles.map(b => [b.id, b])), [bubbles]);
  const roots = bubbles.filter(b => b.depth === 0);

  const parentId = parentPath.length ? parentPath[parentPath.length - 1] : null;
  const parent   = parentId ? byId[parentId] : null;
  const atMax    = !!parent && parent.depth >= MAX_DEPTH;

  // Color defaults to parent's color (so children stay coherent) or a root color.
  const defaultColor = parent?.color ?? (quickCreate
    ? (byId[initialParentPath[initialParentPath.length - 1]]?.color ?? PILLAR_COLORS[0])
    : PILLAR_COLORS[0]);
  const [newColor, setNewColor] = useState<string>(defaultColor);
  const [newScale, setNewScale] = useState<number>(1.0);

  // When the user picks a different parent, reset color to match it.
  useEffect(() => {
    const pid = parentPath[parentPath.length - 1];
    const p = pid ? byId[pid] : null;
    if (p) setNewColor(p.color);
    else if (!parentPath.length) setNewColor(PILLAR_COLORS[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentPath]);

  // Compute the top offset ONCE at mount. On iOS, showing the keyboard shrinks
  // window.innerHeight mid-interaction by ~200px, which shifts the panel up by
  // that much on every re-render and causes every row tap to miss.
  const stableTop = useRef(panelTop());

  // Scroll newly-revealed child levels into view.
  const levelsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = levelsRef.current;
    if (!box) return;
    const sections = box.querySelectorAll('[data-level]');
    sections[sections.length - 1]?.scrollIntoView({ block: 'nearest' });
  }, [parentPath]);

  // Build one selector row per level of the current path that still has children.
  const levels = useMemo(() => {
    const out: { parent: BubbleData; options: BubbleData[]; selected: string | null }[] = [];
    for (let i = 0; i < parentPath.length; i++) {
      const p = byId[parentPath[i]];
      if (!p || p.depth >= MAX_DEPTH) break;
      const kids = bubbles.filter(b => b.parentId === p.id);
      if (!kids.length) break;
      out.push({ parent: p, options: kids, selected: parentPath[i + 1] ?? null });
    }
    return out;
  }, [parentPath, bubbles, byId]);

  const selectAt = (index: number, id: string | null) => {
    setParentPath(p => (id === null ? p.slice(0, index) : [...p.slice(0, index), id]));
  };

  const opts = () => ({
    color: newColor,
    scale: newScale !== 1.0 ? newScale : undefined,
  });

  const submit = () => {
    const t = label.trim();
    if (!t || atMax) return;
    if (quickCreate) {
      onQuickSave?.(quickCreate.id, t, opts());
      onClose();
      return;
    }
    onAdd(t, parentId, opts());
    onClose();
  };

  const cancel = () => {
    if (quickCreate) onQuickCancel?.();
    onClose();
  };

  // A real <button> with a generous py so the touch target reaches 44px.
  const Row = ({ text, selected, onSelect, dim }: { text: string; selected: boolean; onSelect: () => void; dim?: boolean }) => (
    <button type="button" onClick={onSelect}
      className="w-full flex items-center gap-3 cursor-pointer py-3 text-left">
      <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
        style={{ borderColor: selected ? '#9ca3af' : '#d1d5db', background: selected ? '#9ca3af' : 'transparent' }}>
        {selected && <div className="w-2 h-2 rounded-full bg-white"/>}
      </div>
      <span className={`text-base font-light ${dim ? 'text-gray-400' : 'text-gray-600'}`}>{text}</span>
    </button>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: .95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className="absolute z-50 pointer-events-auto"
      style={anchor ? {
        width: Math.min(292, window.innerWidth - 32),
        left: Math.max(16, Math.min(anchor.x + 44, window.innerWidth - Math.min(292, window.innerWidth - 32) - 16)),
        top: Math.max(16, Math.min(anchor.y - 120, window.innerHeight - 290)),
      } : { width: Math.min(292, window.innerWidth - 32), top: stableTop.current, right: 16 }}
      onPointerDown={e => e.stopPropagation()}>
      <div className="p-5"
        style={{ background: 'rgba(255,255,255,.88)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 18, boxShadow: '0 8px 40px rgba(0,0,0,.08),inset 0 0 0 1px rgba(255,255,255,.9)' }}>

        <p className="text-xs font-light text-gray-400 tracking-widest mb-3 uppercase">
          {quickCreate ? 'Name new bubble' : 'New bubble'}
        </p>

        {/* text-base (16px) prevents iOS from zooming the viewport when this input is focused */}
        <input placeholder="Label…" value={label} onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); }}
          className="w-full bg-transparent border-b border-gray-200 text-gray-700 font-light text-base outline-none py-2 mb-4 placeholder-gray-300"/>

        {/* Parent selector (not shown in quickCreate mode — parent is already fixed) */}
        {!quickCreate && <div ref={levelsRef} className="overflow-y-auto pr-1 -mr-1"
          style={{ maxHeight: LIST_MAX_H }}>
          <p className="text-xs text-gray-400 font-light mb-2">Add to</p>
          <div className="flex flex-col gap-1.5 mb-3">
            <Row text="New root bubble" selected={parentPath.length === 0} onSelect={() => setParentPath([])}/>
            {roots.map(r => (
              <Row key={r.id} text={r.label} selected={parentPath[0] === r.id} onSelect={() => selectAt(0, r.id)}/>
            ))}
          </div>

          {levels.map((lvl, i) => (
            <div key={lvl.parent.id} data-level className="mb-3 border-l border-gray-100"
              style={{ paddingLeft: 10, marginLeft: Math.min(i * 8, 40) }}>
              <p className="text-xs text-gray-300 font-light mb-1.5">inside {lvl.parent.label}</p>
              <div className="flex flex-col gap-1.5">
                <Row dim text="Directly here" selected={parentPath.length === i + 1} onSelect={() => selectAt(i + 1, null)}/>
                {lvl.options.map(o => (
                  <Row key={o.id} text={o.label} selected={parentPath[i + 1] === o.id} onSelect={() => selectAt(i + 1, o.id)}/>
                ))}
              </div>
            </div>
          ))}
        </div>}

        {/* ── Color + size ──────────────────────────────────────────────── */}
        {!atMax && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-widest font-light text-gray-400">Color</p>
              <div className="w-5 h-5 rounded-full border-2 border-white shadow-sm flex-shrink-0"
                style={{ background: newColor, boxShadow: '0 0 0 2px rgba(90,90,100,.25)' }}/>
            </div>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {PILLAR_COLORS.map(c => (
                <button key={c} type="button" aria-label={`Color ${c}`}
                  onClick={() => setNewColor(c)}
                  className="rounded-full active:scale-95 transition-transform"
                  style={{ width: 44, height: 44, background: c,
                    boxShadow: newColor === c ? '0 0 0 3px #fff,0 0 0 5px rgba(90,90,100,.4)' : 'inset 0 1px 2px rgba(255,255,255,.5)' }} />
              ))}
            </div>

            <p className="text-xs uppercase tracking-widest font-light text-gray-400 mb-2">Size</p>
            <select value={String(newScale)} onChange={e => setNewScale(Number(e.target.value))}
              className="w-full bg-transparent text-base font-light text-gray-600 outline-none cursor-pointer"
              style={{ border: '1px solid #e5e7eb', borderRadius: 9, padding: '10px 8px', minHeight: 44 }}>
              {SCALE_OPTIONS.map(o => (
                <option key={o} value={String(o)}>{Math.round(o * 100)}%</option>
              ))}
            </select>
          </div>
        )}

        {/* Status line */}
        <div className="mt-3 mb-3">
          {quickCreate ? (
            <p className="text-xs text-gray-300 font-light">
              → child of <span className="text-gray-500">{parent?.label ?? byId[initialParentPath[initialParentPath.length-1]]?.label}</span>
            </p>
          ) : atMax ? (
            <p className="text-xs font-light" style={{ color: 'hsl(0,45%,58%)' }}>
              {parent?.label} is at the maximum depth of {MAX_DEPTH}.
            </p>
          ) : parent ? (
            <p className="text-xs text-gray-300 font-light">
              → inside <span className="text-gray-500">{parent.label}</span> · level {parent.depth + 1}
            </p>
          ) : (
            <p className="text-xs text-gray-300 font-light">→ new root pillar</p>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          {/* py-3 ensures 44px touch target height */}
          <button onClick={cancel} className="text-sm font-light text-gray-400 active:text-gray-600 transition-colors px-4 py-3">Cancel</button>
          <button onClick={submit} disabled={!label.trim() || atMax}
            className="text-sm font-light text-white px-5 py-3 rounded-full transition-opacity disabled:opacity-30"
            style={{ background: newColor }}>
            Add
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Drag origin ──────────────────────────────────────────────────────────────

interface DragOrigin {
  mx: number; my: number; bx: number; by: number; dist: number;
  subtreeOrigins: Record<string, { x: number; y: number }>;
  // Rendered position at grab time + the leash band, so a child drag can be
  // resolved in RENDERED space (where the user is actually pointing).
  rx: number; ry: number;
  band: { minD: number; maxD: number } | null;
  // Whether Shift was down when the press STARTED. Read at press time rather
  // than at release so letting go of the key first still creates the child.
  shift: boolean;
}

// ─── Main canvas ──────────────────────────────────────────────────────────────

export default function MindCanvas() {
  const [bubbles,        setBubbles]        = useState<BubbleData[]>(() => loadBubbles());
  const [focusedId,      setFocusedId]      = useState<string | null>(null);
  const [editingId,      setEditingId]      = useState<string | null>(null);
  const [editValue,      setEditValue]      = useState('');
  const [hoveredBubble,  setHoveredBubble]  = useState<string | null>(null);
  const [showAddPanel,   setShowAddPanel]   = useState(false);
  const [editMode,       setEditMode]       = useState(false);
  const [preEditBubbles, setPreEditBubbles] = useState<BubbleData[] | null>(null);
  const [editSelection,  setEditSelection]  = useState<string | null>(null);
  const [quickCreate,    setQuickCreate]    = useState<{ id: string; parentId: string; anchor: { x: number; y: number } } | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [saveFailedToast, setSaveFailedToast] = useState(false);
  const saveToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const cameraX = useMotionValue(typeof window !== 'undefined' ? window.innerWidth  / 2 : 640);
  const cameraY = useMotionValue(typeof window !== 'undefined' ? window.innerHeight / 2 : 360);
  const cameraScale = useMotionValue(0.5);

  const byId = useMemo(() => Object.fromEntries(bubbles.map(b => [b.id, b])), [bubbles]);

  // Rendered diameters, content-scaled and hierarchy-clamped. Same pure function
  // the animation loop and camera use, so the drawn size always matches the size
  // the solver reserved space for.
  const sizeMap = useMemo(() => viewSizes(bubbles, focusedId).sizes, [bubbles, focusedId]);

  // ── Refs readable from the rAF loop ──────────────────────────────────────

  // Per-bubble MotionValues updated directly in the RAF — Framer Motion writes
  // the new transform straight to the DOM without going through React's
  // reconciler. This eliminates full re-renders every 16 ms and is the main
  // fix for mobile lag during panning and floating animation.
  const bubbleMVs   = useRef<Map<string, { x: MotionValue<number>; y: MotionValue<number> }>>(new Map());

  const bubblesRef  = useRef<BubbleData[]>(bubbles);
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const editModeRef = useRef(false);
  const focusedIdRef = useRef<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  bubblesRef.current  = bubbles;
  editModeRef.current = editMode;
  focusedIdRef.current = focusedId;

  // ── Float + collision resolution ─────────────────────────────────────────

  useEffect(() => {
    const t0 = performance.now();
    let last = 0;
    let raf: number;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 16) return;
      last = now;

      const t = (now - t0) / 1000;

      // Bubbles keep drifting whether or not edit mode is active.
      const { list, map, pos, sizeOf, bandOf } =
        layoutView(bubblesRef.current, focusedIdRef.current, t);

      // Push everything apart until nothing overlaps.
      resolveCollisions(list, map, pos, draggingRef.current, sizeOf, bandOf);

      positionsRef.current = pos;

      // Write positions directly into per-bubble MotionValues so Framer Motion
      // updates the DOM transforms without going through React's reconciler.
      // During a pan the camera MotionValue already redraws everything; skipping
      // MV updates here prevents two competing transform writes per frame and
      // keeps panning smooth on mobile.
      if (activePointers.current.size === 0) {
        for (const b of bubblesRef.current) {
          const p = pos[b.id];
          const mv = bubbleMVs.current.get(b.id);
          if (p && mv) {
            const half = sizeOf(b) / 2;
            mv.x.set(p.x - half);
            mv.y.set(p.y - half);
          }
        }
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Clean up stale MotionValues when bubbles are removed.
  useEffect(() => {
    const ids = new Set(bubbles.map(b => b.id));
    for (const id of bubbleMVs.current.keys()) {
      if (!ids.has(id)) bubbleMVs.current.delete(id);
    }
  }, [bubbles]);

  // Persist to localStorage on every change so the canvas survives page refreshes.
  useEffect(() => {
    const ok = saveBubbles(bubbles);
    if (!ok) {
      setSaveFailedToast(true);
      if (saveToastTimer.current) clearTimeout(saveToastTimer.current);
      saveToastTimer.current = setTimeout(() => setSaveFailedToast(false), 5000);
    }
  }, [bubbles]);

  // ── Ancestors / descendants ──────────────────────────────────────────────

  const ancestorsOf = useCallback((id: string | null): string[] => {
    const out: string[] = [];
    let cur = id ? byId[id] : null;
    while (cur?.parentId) { out.push(cur.parentId); cur = byId[cur.parentId]; }
    return out;
  }, [byId]);

  const descendantsOf = useCallback((id: string): Set<string> => {
    const ids = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const b of bubbles) {
        if (!b.parentId) continue;
        if ((b.parentId === id || ids.has(b.parentId)) && !ids.has(b.id)) { ids.add(b.id); changed = true; }
      }
    }
    return ids;
  }, [bubbles]);

  // Interactive: at overview only roots; when focused, the focused bubble,
  // its whole subtree, and its ancestors (so you can step back out).
  const interactiveIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of bubbles) {
      const layer = relativeLayer(b.id, focusedId, byId);
      // The selected/current layer and its direct children are actionable.
      // Layer 3 is intentionally visual-only, including in edit mode.
      if (layer >= 0 && layer <= 1) ids.add(b.id);
    }
    return ids;
  }, [focusedId, bubbles, byId]);

  // ── Camera helpers ───────────────────────────────────────────────────────

  // Both helpers frame the layout that is actually about to be drawn, computed
  // with drift switched off so the camera targets the resting arrangement.

  const fitAll = useCallback(() => {
    fitLayout(layoutView(bubblesRef.current, null, null),
      cameraX, cameraY, cameraScale, { maxScale: .9, padding: 90 });
  }, [cameraX, cameraY, cameraScale]);

  const focusBubble = useCallback((id: string | null) => {
    setFocusedId(id);
    if (!id) { fitAll(); return; }
    fitLayout(layoutView(bubblesRef.current, id, null),
      cameraX, cameraY, cameraScale, { maxScale: 1.6, padding: 110, spring: true });
  }, [cameraX, cameraY, cameraScale, fitAll]);

  useEffect(() => {
    cameraX.set(window.innerWidth / 2);
    cameraY.set(window.innerHeight / 2);
    const id = setTimeout(fitAll, 60);
    return () => clearTimeout(id);
  }, [cameraX, cameraY, fitAll]);

  // ── Edit mode ────────────────────────────────────────────────────────────

  const enterEditMode = useCallback(() => {
    const currentFocus = focusedIdRef.current;
    setPreEditBubbles(bubblesRef.current.map(b => ({ ...b })));
    setEditMode(true);
    setEditingId(null);
    setEditSelection(null);
    setShowColorPicker(false);
    if (currentFocus) {
      fitLayout(layoutView(bubblesRef.current, currentFocus, null),
        cameraX, cameraY, cameraScale, { maxScale: 1.6, padding: 110 });
    } else {
      fitAll();
    }
  }, [cameraX, cameraY, cameraScale, fitAll]);

  const saveEditMode = useCallback(() => {
    setPreEditBubbles(null);
    setEditMode(false);
    setEditingId(null);
    setEditSelection(null);
    setShowColorPicker(false);
  }, []);

  const cancelEditMode = useCallback(() => {
    if (preEditBubbles) setBubbles(preEditBubbles);
    setPreEditBubbles(null);
    setEditMode(false);
    setEditingId(null);
    setEditSelection(null);
    setShowColorPicker(false);
  }, [preEditBubbles]);

  // ── Step out one level ───────────────────────────────────────────────────

  const stepOut = useCallback(() => {
    if (!focusedId) return;
    const cur = byId[focusedId];
    focusBubble(cur?.parentId ?? null);
  }, [focusedId, byId, focusBubble]);

  // ── Escape ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editingId)    { setEditingId(null); return; }
      if (editMode)     { cancelEditMode(); return; }
      if (showAddPanel) { setShowAddPanel(false); return; }
      if (focusedId)    { stepOut(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [editingId, editMode, showAddPanel, focusedId, cancelEditMode, stepOut]);

  // ── Pan / Pinch-to-zoom ──────────────────────────────────────────────────

  // Track every active pointer by id so we can distinguish single-finger pan
  // from two-finger pinch. The map is keyed by pointerId.
  const activePointers  = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPinchDist   = useRef<number | null>(null);

  const onContainerDown = (e: React.PointerEvent) => {
    if (quickCreate) {
      setBubbles(prev => prev.filter(b => b.id !== quickCreate.id));
      setQuickCreate(null);
      return;
    }
    if (showAddPanel) { setShowAddPanel(false); return; }

    // Register this pointer and capture it so we keep receiving its events
    // even when it moves outside the element.
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);

    if (activePointers.current.size === 1) {
      // First finger — single-touch side-effects (same as before)
      if (editingId) { setEditingId(null); return; }
      if (editMode && editSelection) { setEditSelection(null); setShowColorPicker(false); return; }
      if (focusedId) { stepOut(); }
    } else if (activePointers.current.size === 2) {
      // Second finger — seed the pinch distance; single-pan stops naturally
      // because onContainerMove guards on pointer count.
      const pts = [...activePointers.current.values()];
      lastPinchDist.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }
  };

  const onContainerMove = (e: React.PointerEvent) => {
    const prev = activePointers.current.get(e.pointerId);
    if (!prev) return;

    // Always update the stored position for this pointer first.
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 1) {
      // Single-finger pan — same behaviour as before.
      cameraX.set(cameraX.get() + e.clientX - prev.x);
      cameraY.set(cameraY.get() + e.clientY - prev.y);
    } else if (activePointers.current.size >= 2) {
      // Two-finger pinch — zoom centred on the midpoint between both fingers,
      // using the same clamp limits as the wheel handler (0.06 – 5×).
      const pts  = [...activePointers.current.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);

      if (lastPinchDist.current !== null && lastPinchDist.current > 0 && dist > 0) {
        const f  = dist / lastPinchDist.current;
        const s0 = cameraScale.get();
        const s1 = Math.min(Math.max(0.06, s0 * f), 5);

        const el   = containerRef.current;
        const rect = el?.getBoundingClientRect();
        const midX = (pts[0].x + pts[1].x) / 2 - (rect?.left ?? 0);
        const midY = (pts[0].y + pts[1].y) / 2 - (rect?.top  ?? 0);

        cameraX.set(midX - (midX - cameraX.get()) * (s1 / s0));
        cameraY.set(midY - (midY - cameraY.get()) * (s1 / s0));
        cameraScale.set(s1);
      }

      lastPinchDist.current = dist;
    }
  };

  const onContainerUp = (e: React.PointerEvent) => {
    if (!activePointers.current.has(e.pointerId)) return;
    activePointers.current.delete(e.pointerId);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    // When fewer than two fingers remain, reset pinch state.
    if (activePointers.current.size < 2) lastPinchDist.current = null;
  };

  // ── Zoom ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (editMode) return;
      const f  = Math.exp(-e.deltaY * .002);
      const s0 = cameraScale.get();
      const s1 = Math.min(Math.max(.06, s0 * f), 5);
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      cameraX.set(mx - (mx - cameraX.get()) * (s1 / s0));
      cameraY.set(my - (my - cameraY.get()) * (s1 / s0));
      cameraScale.set(s1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    // iOS Safari fires touch events separately from pointer events and will
    // scroll or pinch-zoom the viewport unless we suppress them with a
    // non-passive listener. Block multi-touch (pinch) moves and any touchstart
    // that begins a two-finger gesture so the page never jumps underneath.
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove',  onTouchMove,  { passive: false });

    return () => {
      el.removeEventListener('wheel',      onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
    };
  }, [editMode, cameraX, cameraY, cameraScale]);

  // ── Drag ─────────────────────────────────────────────────────────────────

  const dragOrigin = useRef<DragOrigin>({
    mx: 0, my: 0, bx: 0, by: 0, dist: 0, subtreeOrigins: {}, rx: 0, ry: 0, band: null,
    shift: false,
  });
  const editClick  = useRef<Record<string, number>>({});
  // When a bubble actually became locked. Locking makes the label interactive,
  // so the very next click of the same double-click gesture can land on it and
  // would otherwise open rename. Requiring the press to start on the label is
  // not enough on its own, because the lock can happen on the FIRST click when
  // an earlier click left the double-click window still open.
  const lockedAt   = useRef<{ id: string; t: number }>({ id: '', t: 0 });

  const onBubbleDown = (e: React.PointerEvent, id: string) => {
    if (editingId === id) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    // Register in the shared pointer map so a second finger on the canvas can
    // detect that two fingers are active and switch to pinch-to-zoom.
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.current.size >= 2) {
      const pts = [...activePointers.current.values()];
      lastPinchDist.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }

    draggingRef.current = id;

    const b = bubblesRef.current.find(x => x.id === id);
    if (!b) return;

    // A root (or the bubble you are inside) moves freely, and its whole subtree
    // travels with it. A child instead moves within its parent's leash, so it
    // only needs the band — its descendants follow automatically.
    const subtreeOrigins: Record<string, { x: number; y: number }> = {};
    if (!b.parentId) {
      const subtree = descendantsOf(id);
      bubblesRef.current.forEach(c => { if (subtree.has(c.id)) subtreeOrigins[c.id] = { x: c.x, y: c.y }; });
    }

    const rendered = positionsRef.current[id] ?? { x: b.x, y: b.y };
    const band = layoutView(bubblesRef.current, focusedIdRef.current, null).bandOf(b);

    dragOrigin.current = {
      mx: e.clientX, my: e.clientY, bx: b.x, by: b.y, dist: 0, subtreeOrigins,
      rx: rendered.x, ry: rendered.y, band, shift: e.shiftKey,
    };
  };

  const onBubbleMove = (e: React.PointerEvent) => {
    // Keep the shared pointer map current so pinch distance stays accurate.
    if (activePointers.current.has(e.pointerId)) {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // When two or more fingers are active, hand off to the pinch handler on
    // the container instead of moving the bubble — this way a pinch that
    // starts on a bubble zooms the canvas rather than dragging that bubble.
    if (activePointers.current.size >= 2) {
      onContainerMove(e);
      return;
    }

    const id = draggingRef.current;
    if (!id || editModeRef.current) return;
    const dx = e.clientX - dragOrigin.current.mx;
    const dy = e.clientY - dragOrigin.current.my;
    dragOrigin.current.dist = Math.hypot(dx, dy);
    const s = cameraScale.get();
    const sdx = dx / s, sdy = dy / s;

    setBubbles(prev => {
      const dragged = prev.find(b => b.id === id);
      if (!dragged) return prev;
      const band = dragOrigin.current.band;
      const parentPos = dragged.parentId ? positionsRef.current[dragged.parentId] : null;

      return prev.map(b => {
        if (b.id === id) {
          // Child: resolve the pointer against the parent's RENDERED position and
          // store an angle + a fraction of the leash, so the drag survives the
          // next frame instead of being recomputed away.
          if (dragged.parentId && band && parentPos) {
            const nrx = dragOrigin.current.rx + sdx;
            const nry = dragOrigin.current.ry + sdy;
            const dx2 = nrx - parentPos.x, dy2 = nry - parentPos.y;
            const d   = Math.hypot(dx2, dy2) || 1;
            const span = Math.max(1, band.maxD - band.minD);
            return {
              ...b,
              angle:  Math.atan2(dy2, dx2),
              radial: clamp01((d - band.minD) / span),
            };
          }
          // Root / focused bubble: free world movement.
          return { ...b, x: dragOrigin.current.bx + sdx, y: dragOrigin.current.by + sdy };
        }
        const so = dragOrigin.current.subtreeOrigins[b.id];
        if (so) return { ...b, x: so.x + sdx, y: so.y + sdy };
        return b;
      });
    });
  };

  const onBubbleUp = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    // Only release what we actually captured — releasing an uncaptured pointer
    // throws, which would abort this handler mid-way.
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // Clean up from the shared pinch-tracking map.
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) lastPinchDist.current = null;
    const isClick = dragOrigin.current.dist < 10;

    if (isClick) {
      if (editModeRef.current) {
        const now = Date.now();
        const wasRecent = now - (editClick.current[id] ?? 0) < 320;
        editClick.current[id] = now;
        const b = bubblesRef.current.find(x => x.id === id);
        if (b && wasRecent) {
          setEditSelection(id);
          setEditValue(b.label);
          lockedAt.current = { id, t: now };
          // End the gesture so a following click starts a fresh one.
          editClick.current[id] = 0;
        }
      } else {
        // Shift-click creates a child; a plain click always enters the bubble.
        // Using a modifier rather than a double-click means the two gestures
        // cannot be confused by an earlier click leaving a window open.
        const withShift = dragOrigin.current.shift || e.shiftKey;
        const b = bubblesRef.current.find(x => x.id === id);
        if (b) {
          if (withShift && b.depth < MAX_DEPTH) {
            const parent = b;
            const depth = parent.depth + 1;
            const siblings = bubblesRef.current.filter(item => item.parentId === parent.id);
            const R = ringRadius(getSize(parent) / 2, sizeForDepth(depth) / 2, siblings.length + 1);
            const angle = siblings.length
              ? Math.atan2(parent.y - (byId[parent.parentId ?? '']?.y ?? parent.y), parent.x - (byId[parent.parentId ?? '']?.x ?? parent.x)) + Math.PI / 2
              : -Math.PI / 2;
            const newId = `n${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
            setBubbles(prev => [...prev, {
              id: newId, parentId: parent.id, depth, label: 'New bubble',
              x: parent.x + Math.cos(angle) * R,
              y: parent.y + Math.sin(angle) * R,
              color: parent.color,
            }]);
            setQuickCreate({ id: newId, parentId: parent.id, anchor: { x: e.clientX, y: e.clientY } });
          }
          else           { focusBubble(focusedId === id ? (b.parentId ?? null) : id); }
        }
      }
    }
    draggingRef.current = null;
  };

  // ── Edit save ────────────────────────────────────────────────────────────

  const handleEditSave = (id: string) => {
    setBubbles(prev => prev.map(b => b.id === id ? { ...b, label: editValue.trim() || b.label } : b));
    setEditingId(null);
  };

  const saveQuickCreate = (id: string, label: string, opts?: { color?: string; scale?: number }) => {
    setBubbles(prev => prev.map(b => b.id === id
      ? { ...b, label, ...(opts?.color ? { color: opts.color } : {}), ...(opts?.scale !== undefined ? { scale: opts.scale } : {}) }
      : b));
    setQuickCreate(null);
  };

  const cancelQuickCreate = () => {
    if (!quickCreate) return;
    setBubbles(prev => prev.filter(b => b.id !== quickCreate.id));
    setQuickCreate(null);
  };

  // ── Add bubble ───────────────────────────────────────────────────────────

  const addBubble = (label: string, parentId: string | null, opts?: { color?: string; scale?: number }) => {
    const id = `n${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

    if (!parentId) {
      const roots = bubbles.filter(b => b.depth === 0);
      const angle = (roots.length / Math.max(roots.length + 1, 3)) * Math.PI * 2 - Math.PI / 2;
      const R = 620 + roots.length * 40;
      const chosenColor = opts?.color ?? ROOT_COLORS[roots.length % ROOT_COLORS.length];
      setBubbles(prev => [...prev, {
        id, depth: 0, label,
        x: Math.cos(angle) * R, y: Math.sin(angle) * R,
        color: chosenColor,
        ...(opts?.scale !== undefined ? { scale: opts.scale } : {}),
      }]);
      return;
    }

    const parent = bubbles.find(b => b.id === parentId);
    if (!parent || parent.depth >= MAX_DEPTH) return;

    const depth    = parent.depth + 1;
    const siblings = bubbles.filter(b => b.parentId === parentId);
    const pr = getSize(parent) / 2;
    const cr = sizeForDepth(depth) / 2;
    const R  = ringRadius(pr, cr, siblings.length + 1);

    // Drop the new bubble into the widest angular gap between existing siblings
    let angle: number;
    if (!siblings.length) {
      const gp = parent.parentId ? byId[parent.parentId] : null;
      angle = gp ? Math.atan2(parent.y - gp.y, parent.x - gp.x) : -Math.PI / 2;
    } else {
      const angles = siblings
        .map(s => Math.atan2(s.y - parent.y, s.x - parent.x))
        .sort((a, b) => a - b);
      let bestGap = -1, bestMid = angles[0] + Math.PI;
      for (let i = 0; i < angles.length; i++) {
        const a1 = angles[i];
        const a2 = i === angles.length - 1 ? angles[0] + Math.PI * 2 : angles[i + 1];
        const gap = a2 - a1;
        if (gap > bestGap) { bestGap = gap; bestMid = a1 + gap / 2; }
      }
      angle = bestMid;
    }

    // Children inherit the explicitly-chosen color; if none was chosen they
    // follow the parent's color so the branch stays coherent.
    const chosenColor = opts?.color ?? parent.color;
    setBubbles(prev => [...prev, {
      id, depth, parentId, label,
      x: parent.x + Math.cos(angle) * R,
      y: parent.y + Math.sin(angle) * R,
      color: chosenColor,
      ...(opts?.scale !== undefined ? { scale: opts.scale } : {}),
    }]);
  };

  // ── Recolor a pillar ─────────────────────────────────────────────────────
  // A pillar's color is the identity of its whole branch, so every descendant
  // inherits it. Duplicate-checking happens inside the picker.

  const recolorPillar = (id: string, color: string) => {
    const family = new Set<string>([id, ...descendantsOf(id)]);
    setBubbles(prev => prev.map(b => (family.has(b.id) ? { ...b, color } : b)));
  };

  // ── Recolor a single bubble (depth 1+) ───────────────────────────────────
  // Below the pillar, color is per-bubble: it touches neither the parent nor
  // any child, so a branch can carry accents without losing its identity.

  const recolorBubble = (id: string, color: string) => {
    setBubbles(prev => prev.map(b => (b.id === id ? { ...b, color } : b)));
  };

  // ── Resize a single bubble ───────────────────────────────────────────────

  const resizeBubble = (id: string, scale: number) => {
    const next = Math.min(Math.max(scale, SCALE_MIN), SCALE_MAX);
    setBubbles(prev => prev.map(b => (b.id === id ? { ...b, scale: next } : b)));
  };

  // ── Delete bubble (and its whole subtree) ────────────────────────────────

  const deleteBubble = (id: string) => {
    const doomed = new Set<string>([id, ...descendantsOf(id)]);
    setBubbles(prev => prev.filter(b => !doomed.has(b.id)));
    if (focusedId && doomed.has(focusedId)) setFocusedId(null);
    if (editingId && doomed.has(editingId)) setEditingId(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const pillBase: React.CSSProperties = {
    background: 'rgba(255,255,255,.84)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    borderRadius: 24,
    // 13px vertical padding → ~43px total height with text, meeting 44px touch target.
    padding: '13px 20px',
    boxShadow: '0 4px 24px rgba(0,0,0,.07),inset 0 0 0 1px rgba(255,255,255,.9)',
    fontSize: 14,
  };

  const breadcrumb = focusedId
    ? [...ancestorsOf(focusedId).reverse(), focusedId].map(i => byId[i]?.label).filter(Boolean)
    : [];

  return (
    <div ref={containerRef} className="w-screen h-screen overflow-hidden touch-none relative"
      style={{ background: '#e9ece9' }}
      onPointerDown={onContainerDown} onPointerMove={onContainerMove}
      onPointerUp={onContainerUp} onPointerCancel={onContainerUp} onPointerLeave={onContainerUp}>

      {/* Soft lens/vignette over the moving coordinate field. */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none z-10"
        style={{ background: 'radial-gradient(ellipse at center,rgba(255,255,255,0) 38%,rgba(118,128,122,.11) 100%)' }} />

      {/* Edit mode banner */}
      {editMode && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="absolute top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none select-none text-center"
          style={{ background: 'rgba(255,255,255,.84)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 20, padding: '8px 18px', boxShadow: '0 2px 16px rgba(0,0,0,.06),inset 0 0 0 1px rgba(130,110,180,.25)', fontSize: 12, color: 'hsl(260,40%,50%)', letterSpacing: '.04em', fontWeight: 300, maxWidth: 'calc(100vw - 32px)' }}>
          Edit mode · double-tap to lock · tap name to rename · × deletes
        </motion.div>
      )}

      {/* Save-failed toast */}
      {saveFailedToast && (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
          className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none select-none text-center"
          style={{ background: 'rgba(255,248,245,.94)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 20, padding: '9px 20px', boxShadow: '0 2px 20px rgba(0,0,0,.09),inset 0 0 0 1px rgba(200,80,60,.22)', fontSize: 12, color: 'hsl(12,55%,40%)', letterSpacing: '.03em', fontWeight: 300, maxWidth: 'calc(100vw - 32px)', whiteSpace: 'nowrap' }}>
          ⚠ Map could not be saved — storage may be full. Your changes exist until you refresh.
        </motion.div>
      )}

      {/* Breadcrumb */}
      {!editMode && breadcrumb.length > 0 && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="absolute top-5 left-1/2 -translate-x-1/2 z-40 pointer-events-none select-none flex items-center gap-1.5"
          style={{ background: 'rgba(255,255,255,.7)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 20, padding: '5px 16px', boxShadow: '0 2px 14px rgba(0,0,0,.05)', fontSize: 11.5, color: '#8b8b96', fontWeight: 300, letterSpacing: '.03em' }}>
          {breadcrumb.map((l, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span style={{ opacity: .4 }}>›</span>}
              <span style={{ color: i === breadcrumb.length - 1 ? '#5b5b68' : undefined }}>{l}</span>
            </span>
          ))}
        </motion.div>
      )}

      {/* World */}
      <motion.div className="absolute top-0 left-0 origin-top-left"
        style={{ x: cameraX, y: cameraY, scale: cameraScale }}>

        <CoordinateField />

        {bubbles.filter(b => isInThreeLayerView(b, focusedId, byId)).map(bubble => {
          const layer = relativeLayer(bubble.id, focusedId, byId);
          // Size always comes from the relative layer, matching the solver.
          const size  = sizeMap[bubble.id] ?? getSize(bubble);

          // Lazily create MotionValues for this bubble. The RAF updates them
          // directly so this div never re-renders just because a bubble moved.
          let mv = bubbleMVs.current.get(bubble.id);
          if (!mv) {
            const px = positionsRef.current[bubble.id];
            mv = {
              x: motionValue((px?.x ?? bubble.x) - size / 2),
              y: motionValue((px?.y ?? bubble.y) - size / 2),
            };
            bubbleMVs.current.set(bubble.id, mv);
          }

          const interactive = interactiveIds.has(bubble.id);
          const visualOnly = layer === 2;
          const muted = visualOnly;

          const isFocused  = bubble.id === focusedId;
          const isHovered  = hoveredBubble === bubble.id;
          const isEditSelected = editMode && editSelection === bubble.id;
          const showDelete = editMode && isEditSelected && bubble.id !== editingId;
          const opacity    = visualOnly ? .64 : 1;

          return (
            <motion.div key={bubble.id}
              className={`absolute top-0 left-0 rounded-full ${
                !interactive || muted        ? 'pointer-events-none'
                : editingId === bubble.id    ? 'cursor-text'
                : editMode                   ? 'cursor-pointer'
                : 'cursor-grab active:cursor-grabbing'
              }`}
              style={{
                x: mv.x,
                y: mv.y,
                width: size, height: size,
                touchAction: 'none', overflow: 'visible',
                // A locked bubble's color/size panel must draw above every
                // sibling, including ones at a shallower depth (which
                // otherwise sit at a higher default z-index).
                zIndex: isEditSelected ? 1000 : 100 - bubble.depth,
              }}
              initial={false}
              animate={{ opacity, scale: isFocused || isEditSelected ? 1.04 : 1, filter: 'blur(0px)' }}
              whileHover={interactive && !muted && editingId !== bubble.id ? { scale: isFocused ? 1.04 : 1.03, filter: 'blur(0px) brightness(1.05)' } : undefined}
              transition={{ type: 'spring', stiffness: 55, damping: 16 }}
              onPointerDown={e => onBubbleDown(e, bubble.id)}
              onPointerMove={onBubbleMove}
              onPointerUp={e => onBubbleUp(e, bubble.id)}
              onPointerCancel={e => onBubbleUp(e, bubble.id)}
              onMouseEnter={() => !visualOnly && setHoveredBubble(bubble.id)}
              onMouseLeave={() => setHoveredBubble(h => h === bubble.id ? null : h)}
            >
              {visualOnly ? (
                // Third layer is a bare presence marker: no label, no chrome.
                <div style={{
                  width: size, height: size, borderRadius: '50%',
                  background: bubble.color,
                  boxShadow: '0 1px 3px rgba(0,0,0,.20), inset 0 1px 1.5px rgba(255,255,255,.65)',
                }} />
              ) : (
                <GlassBubbleSVG size={size} color={bubble.color} label={bubble.label}
                  isEditing={editingId === bubble.id} editValue={editValue}
                  onEditChange={setEditValue}
                  onEditSave={() => handleEditSave(bubble.id)}
                  onEditCancel={() => setEditingId(null)}
                  onLabelClick={editMode && isEditSelected && !visualOnly
                    ? () => {
                        // Ignore the click that completed the locking gesture.
                        if (lockedAt.current.id === bubble.id
                          && Date.now() - lockedAt.current.t < 350) return;
                        setEditingId(bubble.id);
                        setEditValue(bubble.label);
                      }
                    : undefined}
                />
              )}

              {/* Lock indicator: a locked bubble must be unmistakable, since
                  every edit action (rename, recolour, delete) applies to it. */}
              {isEditSelected && (
                <motion.div aria-hidden="true"
                  initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }}
                  className="absolute rounded-full pointer-events-none"
                  style={{
                    inset: -Math.max(6, size * .05),
                    border: `2px dashed ${LOCK_RING}`,
                    boxShadow: `0 0 0 3px rgba(130,110,180,.10)`,
                    zIndex: 250,
                  }} />
              )}

              {editMode && isEditSelected && !visualOnly && (
                <BubbleEditPanel
                  color={bubble.color}
                  scale={bubbleScale(bubble)}
                  isPillar={bubble.depth === 0}
                  inheritedColor={bubble.parentId ? byId[bubble.parentId]?.color : undefined}
                  existingColors={bubbles.filter(b => b.depth === 0 && b.id !== bubble.id).map(b => b.color)}
                  onChoose={next => bubble.depth === 0
                    ? recolorPillar(bubble.id, next)
                    : recolorBubble(bubble.id, next)}
                  onResetColor={bubble.parentId
                    ? () => recolorBubble(bubble.id, byId[bubble.parentId!]?.color ?? bubble.color)
                    : undefined}
                  onScale={next => resizeBubble(bubble.id, next)}
                />
              )}

              {showDelete && (
                // Visual circle stays small but the real tap target is 44×44
                // via padding so it's easy to hit on touch screens.
                <motion.button initial={{ opacity: 0, scale: .7 }} animate={{ opacity: 1, scale: 1 }}
                  className="absolute flex items-center justify-center pointer-events-auto"
                  style={{ width: 44, height: 44, right: -14, top: -14, zIndex: 300 }}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); deleteBubble(bubble.id); }}>
                  <span className="flex items-center justify-center rounded-full"
                    style={{ width: 22, height: 22, background: 'rgba(255,255,255,.94)', boxShadow: '0 1px 6px rgba(0,0,0,.14)', color: '#aaa', fontSize: 14, lineHeight: 1, backdropFilter: 'blur(4px)' }}>
                    ×
                  </span>
                </motion.button>
              )}
            </motion.div>
          );
        })}
      </motion.div>

      {/* Hint — sits at the top so it doesn't compete with the bottom action bar */}
      {!focusedId && !editMode && !quickCreate && !showAddPanel && (
        <motion.p className="absolute top-20 left-1/2 -translate-x-1/2 text-gray-400 font-light text-xs tracking-widest pointer-events-none select-none whitespace-nowrap z-30"
          initial={{ opacity: 0 }} animate={{ opacity: .4 }} transition={{ delay: 1.5, duration: 1.5 }}>
          tap to enter · + to add bubbles
        </motion.p>
      )}

      {/* Add panel */}
      {showAddPanel && (
        <AddPanel bubbles={bubbles} onAdd={addBubble} onClose={() => setShowAddPanel(false)}/>
      )}
      {quickCreate && (
        <AddPanel
          bubbles={bubbles}
          onAdd={addBubble}
          onClose={() => setQuickCreate(null)}
          initialParentPath={[quickCreate.parentId]}
          quickCreate={{ id: quickCreate.id }}
          anchor={quickCreate.anchor}
          onQuickSave={saveQuickCreate}
          onQuickCancel={cancelQuickCreate}
        />
      )}

      {/* Buttons */}
      <div className="absolute bottom-6 right-6 z-50 flex gap-3 pointer-events-auto"
        onPointerDown={e => e.stopPropagation()}>
        {editMode ? (
          <>
            <motion.button style={{ ...pillBase, color: 'hsl(0,45%,55%)' }}
              className="flex items-center gap-2 font-light"
              whileHover={{ scale: 1.04 }} whileTap={{ scale: .97 }}
              onClick={cancelEditMode}>
              Cancel
            </motion.button>
            <motion.button
              style={{ ...pillBase, background: 'rgba(130,110,180,.15)', boxShadow: '0 4px 24px rgba(130,110,180,.12),inset 0 0 0 1px rgba(130,110,180,.3)', color: 'hsl(260,50%,45%)' }}
              className="flex items-center gap-2 font-light"
              whileHover={{ scale: 1.04 }} whileTap={{ scale: .97 }}
              onClick={saveEditMode}>
              <span style={{ fontSize: 13, lineHeight: 1 }}>✓</span> Save
            </motion.button>
          </>
        ) : (
          <>
            <motion.button style={pillBase}
              className="flex items-center gap-2 font-light text-gray-500"
              whileHover={{ scale: 1.04 }} whileTap={{ scale: .97 }}
              onClick={enterEditMode}>
              <span style={{ fontSize: 13, lineHeight: 1, opacity: .7 }}>✎</span> Edit
            </motion.button>
            <motion.button style={pillBase}
              className="flex items-center gap-2 font-light text-gray-500"
              whileHover={{ scale: 1.04 }} whileTap={{ scale: .97 }}
              onPointerDown={e => e.stopPropagation()}
              onPointerUp={e => e.stopPropagation()}
              onClick={e => {
                // Always open — a toggle here silently swallows a second click.
                e.stopPropagation();
                cancelQuickCreate();
                setShowAddPanel(true);
              }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add bubble
            </motion.button>
            <motion.button style={pillBase}
              className="flex items-center gap-2 font-light text-gray-500"
              whileHover={{ scale: 1.04 }} whileTap={{ scale: .97 }}
              onClick={() => {
                if (!window.confirm('Clear the canvas and start fresh?')) return;
                clearBubbles();
                setBubbles(INITIAL_BUBBLES);
                setFocusedId(null);
                setEditMode(false);
                setEditingId(null);
                setEditSelection(null);
                setQuickCreate(null);
                setShowAddPanel(false);
              }}>
              <span style={{ fontSize: 13, lineHeight: 1, opacity: .6 }}>↺</span> Clear
            </motion.button>
          </>
        )}
      </div>
    </div>
  );
}
