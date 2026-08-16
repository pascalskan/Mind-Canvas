import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { motion, useMotionValue, useTransform, animate, motionValue, type MotionValue } from 'framer-motion';
import {
  clearBubbles,
  exportBubbles,
  importBubbles,
  STORAGE_QUOTA_BYTES,
  STORAGE_WARN_RATIO,
  type BubbleData,
} from '../persistence';
import {
  MAX_DEPTH,
  GAP,
  DEPTH_SIZE,
  SCALE_MIN,
  SCALE_MAX,
  SCALE_STEP,
  ROOT_COLORS,
  sizeForDepth,
  getSize,
  ringRadius,
  bubbleScale,
} from '../lib/bubbleLayout';
import { applyRootDrag, applyChildDrag, shouldWriteBubbleMotionValues, isBackgroundTap, descendantsOf as descendantsOfPure } from '../lib/dragHelpers';
import SettingsPanel from './SettingsPanel';
import SaveAvailablePrompt from './SaveAvailablePrompt';
import { useBubbleState } from '../hooks/useBubbleState';

// ─── Types ────────────────────────────────────────────────────────────────────
// Everything on the canvas is a bubble. There is no "content" — a note, an item,
// a sub-task are all just bubbles nested one level deeper.
//
// BubbleData is defined in ../persistence and re-exported from there so it can
// be unit-tested independently of the React component tree.

// ─── Sizes ────────────────────────────────────────────────────────────────────
// MAX_DEPTH, GAP, DEPTH_SIZE, sizeForDepth, getSize, ringRadius are imported
// from ../lib/bubbleLayout (shared with useBubbleState).

// Only ever three layers are on screen, so on-screen size STARTS from the
// RELATIVE layer, never from absolute depth. That is what makes depth 8 read
// and behave exactly like depth 1 once you are standing inside it. The bubble's
// own manual scale is the only thing applied on top.
const LAYER_SIZE_OVERVIEW = [320, 166, 18];
const LAYER_SIZE_FOCUSED  = [250, 132, 16];

// ─── Manual size ──────────────────────────────────────────────────────────────
// Size is set by hand, never inferred from how much a bubble contains.
// SCALE_MIN, SCALE_MAX, SCALE_STEP imported from ../lib/bubbleLayout.

const SCALE_OPTIONS = Array.from(
  { length: Math.round((SCALE_MAX - SCALE_MIN) / SCALE_STEP) + 1 },
  (_, i) => Math.round((SCALE_MIN + i * SCALE_STEP) * 10) / 10,
);

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

// ringRadius is imported from ../lib/bubbleLayout.

// The band a child may live in, measured in RENDERED radii:
//   minD    — touching its parent
//   natural — where it sits if it has never been dragged
//   maxD    — the end of its leash
// One definition, used by the layout, the drag and the collision solver, so
// none of them can pull a bubble back out of where another put it.
function radialBand(pr: number, cr: number, n: number, maxSiblingR: number = cr) {
  const minD    = pr + cr + GAP;
  const natural = ringRadius(pr, cr, n, maxSiblingR);
  const maxD    = Math.max(natural + Math.max(40, pr * 0.9), minD + Math.max(48, pr * 1.6));
  return { minD, maxD, natural };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Whether `target` sits inside a scrollable element below `root` — i.e. whether
 * this gesture belongs to a panel rather than to the canvas.
 *
 * Both the wheel and the touch handlers need this. The canvas suppresses
 * default scrolling so a drag pans instead of scrolling the page, but doing
 * that indiscriminately also swallows scrolling INSIDE the panels that sit on
 * top of it — which made the Add panel's lower half unreachable, since the
 * wheel zoomed the canvas instead of moving the list.
 */
function isInScrollable(target: EventTarget | null, root: Element): boolean {
  let node = target as Element | null;
  while (node && node !== root) {
    // Text nodes and SVG children have no computed overflow worth reading.
    if (node instanceof HTMLElement) {
      const ov = window.getComputedStyle(node).overflowY;
      if ((ov === 'scroll' || ov === 'auto') && node.scrollHeight > node.clientHeight) return true;
    }
    node = node.parentElement;
  }
  return false;
}

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

// ─── Layer-2 pip cluster ──────────────────────────────────────────────────────
// How the indicator dots sit around their parent. See the layer === 2 branch in
// layoutView for why they ignore their stored position entirely.
const PIP_HOVER_GAP  = 14;                   // world px between parent edge and pip
const PIP_FAN_STEP   = 0.34;                 // radians between adjacent pips
const PIP_FAN_MAX_ARC = Math.PI * 1.25;      // total arc the fan may occupy

// Per-frame follow factor for the eased layout. ~0.18 settles a large jump in
// roughly a third of a second, which reads as travel rather than teleport,
// while leaving continuous drift indistinguishable from unsmoothed.
const POSITION_EASE = 0.18;
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

// ROOT_COLORS is imported from ../lib/bubbleLayout.

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

  // The largest child on each ring, so the angular spacing clears the biggest
  // neighbour rather than assuming every sibling is the same size. Without it,
  // a small bubble sitting next to a scaled-up one computes a ring tight enough
  // for itself and gets overlapped.
  const ringMaxR: Record<string, number> = {};
  for (const [parentId, ids] of Object.entries(rings)) {
    ringMaxR[parentId] = Math.max(...ids.map(id => sizeOf(map[id]) / 2));
  }

  const bandOf = (b: BubbleData) => {
    const parent = b.parentId ? map[b.parentId] : null;
    if (!parent) return null;
    const ring = rings[parent.id] ?? [b.id];
    return radialBand(sizeOf(parent) / 2, sizeOf(b) / 2, ring.length, ringMaxR[parent.id] ?? sizeOf(b) / 2);
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

    // ── Layer 2 is an INDICATOR, not the bubble ─────────────────────────────
    //
    // A layer-2 pip is an 18px dot that exists to say "there is more inside
    // this bubble". It is not a view of where those children actually live, so
    // it deliberately ignores its own stored angle/radial and instead hovers in
    // a tight fan just off its parent, on the far side from the grandparent —
    // pointing outward, away from where the user came from, so the dots read as
    // "further in" rather than scattering back across the parent.
    //
    // Nothing stored changes. The moment the parent is focused, this bubble
    // becomes layer 1, falls through to the normal branch below, and glides
    // back to its real position (the tick smooths the handover).
    if (layer === 2) {
      const gp    = parent.parentId ? map[parent.parentId] : null;
      const gpPos = gp ? pos[gp.id] : null;
      // Direction from the grandparent through the parent and onward.
      const away = gpPos
        ? Math.atan2(pp.y - gpPos.y, pp.x - gpPos.x)
        : -Math.PI / 2;
      // Fan the siblings across an arc centred on that direction, tightening
      // the step as the count grows so a large set still stays a neat cluster.
      const step  = Math.min(PIP_FAN_STEP, PIP_FAN_MAX_ARC / Math.max(1, ring.length));
      const angle = away + (index - (ring.length - 1) / 2) * step;
      const r     = sizeOf(parent) / 2 + sizeOf(b) / 2 + PIP_HOVER_GAP;
      pos[b.id] = {
        x: pp.x + Math.cos(angle) * r + ownX,
        y: pp.y + Math.sin(angle) * r + ownY,
      };
      continue;
    }

    const dx = b.x - parent.x, dy = b.y - parent.y;
    // Explicit dragged angle wins; otherwise fall back to the seeded direction,
    // and finally to an even spread around the ring.
    let angle = b.angle ?? (Math.hypot(dx, dy) > 1
      ? Math.atan2(dy, dx)
      : (index / ring.length) * TAU - Math.PI / 2);

    const band = radialBand(sizeOf(parent) / 2, sizeOf(b) / 2, ring.length, ringMaxR[parent.id] ?? sizeOf(b) / 2);
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

// ─── Label legibility ─────────────────────────────────────────────────────────
//
// Labels live in world space, so their on-screen size is (world size × camera
// scale) — unreadably small zoomed out, absurdly large zoomed in. These bounds
// clamp the RENDERED size instead: text still scales with the canvas through
// the comfortable middle, but stops shrinking and stops growing at the edges.
const LABEL_MIN_PX = 11;
const LABEL_MAX_PX = 22;
// Clamping alone would leave every distant bubble carrying a full-size label,
// which turns a zoomed-out canvas into overlapping text. So a label also fades
// out once its bubble is too small on screen to hold it — the bubble itself
// still reads as a shape, which is all it is at that distance.
const LABEL_FADE_FROM_PX = 52;   // fully visible at or above this screen diameter
const LABEL_FADE_TO_PX   = 28;   // fully transparent at or below

function GlassBubbleSVG({ size, color, label, isEditing, editValue, onEditChange, onEditSave, onEditCancel, onLabelClick, cameraScale, hideLabel }: {
  size: number; color: string; label: string;
  isEditing?: boolean; editValue?: string;
  onEditChange?: (v: string) => void; onEditSave?: () => void; onEditCancel?: () => void;
  onLabelClick?: () => void;
  cameraScale: MotionValue<number>;
  /** Text-hidden view: the bubble stays, its label fades out. */
  hideLabel?: boolean;
}) {
  const uid = (color + Math.round(size)).replace(/[^a-zA-Z0-9]/g, '');
  const fontSize = Math.max(size * 0.135, 8.5);

  // Divide the clamped screen size back out by the camera scale, because this
  // element is inside the world transform and will be multiplied by it again.
  const labelFontSize = useTransform(cameraScale, s => {
    const scale = Math.max(s, 1e-4);
    const onScreen = fontSize * scale;
    return Math.min(Math.max(onScreen, LABEL_MIN_PX), LABEL_MAX_PX) / scale;
  });
  const zoomOpacity = useTransform(cameraScale, s => {
    const diameterOnScreen = size * Math.max(s, 1e-4);
    if (diameterOnScreen >= LABEL_FADE_FROM_PX) return 1;
    if (diameterOnScreen <= LABEL_FADE_TO_PX)   return 0;
    return (diameterOnScreen - LABEL_FADE_TO_PX) / (LABEL_FADE_FROM_PX - LABEL_FADE_TO_PX);
  });
  // Hiding MULTIPLIES into the distance fade rather than replacing it, so a
  // label already half-faded by zoom does not pop to full strength on the way
  // back in. Animated rather than switched: at 0.18s the release reads as the
  // words settling back onto the canvas instead of a flicker.
  const reveal = useMotionValue(hideLabel ? 0 : 1);
  useEffect(() => {
    const controls = animate(reveal, hideLabel ? 0 : 1, { duration: .18, ease: 'easeOut' });
    return () => controls.stop();
  }, [hideLabel, reveal]);
  const labelOpacity = useTransform([zoomOpacity, reveal], ([z, r]: number[]) => z * r);
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
        <motion.div className="relative z-10 text-gray-700 font-sans font-light tracking-wide select-none text-center break-words"
          // A label faded to nothing must not still take clicks - otherwise
          // renaming stays armed on text the user cannot see.
          style={{ pointerEvents: onLabelClick && !hideLabel ? 'auto' : 'none', fontSize: labelFontSize, opacity: labelOpacity, lineHeight: 1.15, maxWidth: '84%' }}
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
        </motion.div>
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
function BubbleEditPanel({ color, scale, isPillar, inheritedColor, existingColors, onChoose, onScale, onResetColor, counterScale }: {
  color: string;
  scale: number;
  isPillar: boolean;
  inheritedColor?: string;
  existingColors: string[];
  onChoose: (color: string) => void;
  onScale: (scale: number) => void;
  onResetColor?: () => void;
  /**
   * 1 / camera scale. This panel lives inside the world-space transform, so
   * without it the controls shrank with the canvas — unusable at exactly the
   * zoom level where you are rearranging things and most need them. Undoing the
   * camera scale pins the panel to a constant SCREEN size while it stays
   * anchored to its bubble.
   */
  counterScale: MotionValue<number>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const choose = (next: string) => {
    if (isPillar && existingColors.some(used => colorsAreClose(used, next))) setPending(next);
    else onChoose(next);
  };

  return (
    <motion.div className="absolute pointer-events-auto z-50"
      style={{
        top: 'calc(100% + 15px)',
        left: '50%',
        x: '-50%',
        scale: counterScale,
        // Grow downward from the bubble as it counter-scales, rather than
        // about its own middle, so the panel stays attached at the top.
        transformOrigin: 'top center',
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
    </motion.div>
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
      } : {
        width: Math.min(292, window.innerWidth - 32),
        top: stableTop.current,
        right: 16,
        // Hard stop at the bottom of the window. stableTop is derived from a
        // FIXED 200px estimate of everything that isn't the scrollable list
        // (see panelTop) — but the breadcrumb path and level headings grow as
        // you drill in, so past a few levels the real chrome exceeded the
        // estimate and the bottom of the panel ran off screen with no way to
        // reach it. The list cap alone could not prevent that; only the panel
        // itself knows where the window ends.
        maxHeight: `calc(100vh - ${stableTop.current + 16}px)`,
        display: 'flex',
      }}
      onPointerDown={e => e.stopPropagation()}>
      <div className="p-5 overflow-y-auto"
        style={{ background: 'rgba(255,255,255,.88)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 18, boxShadow: '0 8px 40px rgba(0,0,0,.08),inset 0 0 0 1px rgba(255,255,255,.9)', flex: 1, minHeight: 0 }}>

        <p className="text-xs font-light text-gray-400 tracking-widest mb-3 uppercase">
          {quickCreate ? 'Name new bubble' : 'New bubble'}
        </p>

        {/* text-base (16px) prevents iOS from zooming the viewport when this input is focused */}
        {/* Escape must go through cancel(), not the raw onClose prop — in
            quickCreate mode onClose only hides the panel, leaving the
            already-created placeholder bubble in state forever. cancel()
            also calls onQuickCancel to delete it, matching the Cancel button
            and a background click. */}
        <input placeholder="Label…" value={label} onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') cancel(); }}
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
  // Declared before useBubbleState so its current value can hold back the
  // newer-save prompt for the duration of an edit session.
  const [editMode, setEditMode] = useState(false);
  const {
    bubbles,
    setBubbles,
    byId,
    lastSave,
    cloudSaveOk,
    addBubble,
    deleteBubblesById,
    renameBubble,
    canvasName,
    setCanvasName,
    saving,
    saveCanvas,
    saveError,
    hasUnsavedChanges,
    syncState,
    savedMeta,
    pendingSave,
    acceptPendingSave,
    dismissPendingSave,
  } = useBubbleState(INITIAL_BUBBLES, editMode);
  const [focusedId,      setFocusedId]      = useState<string | null>(null);
  const [editingId,      setEditingId]      = useState<string | null>(null);
  const [editValue,      setEditValue]      = useState('');
  const [showAddPanel,   setShowAddPanel]   = useState(false);
  const [showSettings,   setShowSettings]   = useState(false);
  const [preEditBubbles, setPreEditBubbles] = useState<BubbleData[] | null>(null);
  const [editSelection,  setEditSelection]  = useState<string | null>(null);
  const [quickCreate,    setQuickCreate]    = useState<{ id: string; parentId: string; anchor: { x: number; y: number } } | null>(null);
  // Hold Tab: every label leaves the canvas so it can be read as pure shape,
  // colour and arrangement. See the keyboard effect below.
  const [textHidden,     setTextHidden]     = useState(false);
  const [saveFailedToast,  setSaveFailedToast]  = useState(false);
  const [storageNearLimit, setStorageNearLimit] = useState(false);
  // null  = not dismissed this session (banner shows when storageNearLimit is true)
  // number = bytes at time of dismiss; banner re-appears if bytes grow beyond this
  const [dismissedAtBytes, setDismissedAtBytes] = useState<number | null>(() => {
    try {
      const v = sessionStorage.getItem('mc_storageWarnDismissed');
      return v !== null ? Number(v) : null;
    } catch { return null; }
  });
  const saveToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef  = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const cameraX = useMotionValue(typeof window !== 'undefined' ? window.innerWidth  / 2 : 640);
  const cameraY = useMotionValue(typeof window !== 'undefined' ? window.innerHeight / 2 : 360);
  const cameraScale = useMotionValue(0.5);
  // Undoes the camera scale for UI that lives inside the world transform but
  // must stay a fixed size on screen — currently the per-bubble edit panel.
  // Created once here because the bubbles are rendered in a .map(), where hooks
  // cannot be called.
  const counterScale = useTransform(cameraScale, s => 1 / Math.max(s, 1e-4));

  // byId is provided by useBubbleState.

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

  // Eased positions, one per visible bubble — see the smoothing pass in the
  // tick. Held in a ref because it is written every frame and must never
  // trigger a React render.
  const smoothPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());

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

      // ── Ease toward the computed layout ──────────────────────────────────
      //
      // Focusing a bubble changes what layer its descendants are on, and a
      // layer-2 pip sits somewhere completely different from the same bubble at
      // layer 1 (see layoutView). Writing the target straight to the DOM made
      // that handover a hard teleport. Following the target instead means the
      // pips visibly travel out to their real positions when you go in, and
      // gather back to the parent when you come out.
      //
      // The factor is high enough that ordinary drift — slow and continuous —
      // is followed imperceptibly, so this costs nothing in the steady state.
      // A bubble seen for the first time starts AT its target rather than
      // flying in from wherever the previous occupant of that id was.
      const smooth = smoothPosRef.current;
      const dragging = draggingRef.current;
      for (const b of list) {
        const target = pos[b.id];
        if (!target) continue;
        const prev = smooth.get(b.id);
        // A dragged bubble must track the pointer exactly, with no lag.
        if (!prev || b.id === dragging) {
          smooth.set(b.id, { x: target.x, y: target.y });
          continue;
        }
        prev.x += (target.x - prev.x) * POSITION_EASE;
        prev.y += (target.y - prev.y) * POSITION_EASE;
        pos[b.id] = { x: prev.x, y: prev.y };
      }
      // Drop bubbles that are no longer in view so a re-entry starts fresh at
      // its target rather than gliding in from a stale position.
      if (smooth.size > list.length) {
        const live = new Set(list.map(b => b.id));
        for (const id of smooth.keys()) if (!live.has(id)) smooth.delete(id);
      }

      positionsRef.current = pos;

      // Write positions directly into per-bubble MotionValues so Framer Motion
      // updates the DOM transforms without going through React's reconciler.
      // See shouldWriteBubbleMotionValues for why this is gated on panning
      // specifically, not on "any pointer active".
      if (shouldWriteBubbleMotionValues(activePointers.current.size, draggingRef.current)) {
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

  // React to the save result emitted by useBubbleState: show the toast on
  // failure, or update the quota-warning banner on success.
  useEffect(() => {
    const { ok, bytes } = lastSave;
    if (!ok) {
      setSaveFailedToast(true);
      if (saveToastTimer.current) clearTimeout(saveToastTimer.current);
      saveToastTimer.current = setTimeout(() => setSaveFailedToast(false), 5000);
      // Re-arm the storage warning so it reappears alongside the save-failed toast
      // once the toast clears — the user may not have noticed the earlier banner.
      setDismissedAtBytes(null);
      try { sessionStorage.removeItem('mc_storageWarnDismissed'); } catch { /* ignore */ }
    } else {
      // Show a persistent warning banner when payload crosses 80 % of the
      // estimated 5 MB localStorage quota. Clear it automatically when the
      // map shrinks back below the threshold.
      setStorageNearLimit(bytes >= STORAGE_QUOTA_BYTES * STORAGE_WARN_RATIO);
    }
  }, [lastSave]);

  // ── Ancestors / descendants ──────────────────────────────────────────────

  const ancestorsOf = useCallback((id: string | null): string[] => {
    const out: string[] = [];
    let cur = id ? byId[id] : null;
    while (cur?.parentId) { out.push(cur.parentId); cur = byId[cur.parentId]; }
    return out;
  }, [byId]);

  // See ../lib/dragHelpers for the implementation and its tests.
  const descendantsOf = useCallback((id: string): Set<string> => descendantsOfPure(bubbles, id), [bubbles]);

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

  // fitLayout already reads window.innerWidth/innerHeight fresh on every call
  // rather than caching them, so re-running the current fit is all a resize
  // needs — but nothing was ever triggering that re-run. A desktop window
  // resize (or a react-native-web viewport change) left the camera framed for
  // the OLD size: content could run off-screen or sit oddly off-center until
  // the next unrelated fit (focusing a bubble, entering edit mode, etc.)
  // happened to correct it. Debounced so a drag-resize doesn't restart the
  // fit animation on every intermediate frame.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const fid = focusedIdRef.current;
        if (fid) {
          fitLayout(layoutView(bubblesRef.current, fid, null),
            cameraX, cameraY, cameraScale, { maxScale: 1.6, padding: 110, spring: true });
        } else {
          fitAll();
        }
      }, 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timer) clearTimeout(timer);
    };
  }, [cameraX, cameraY, cameraScale, fitAll]);

  // ── Edit mode ────────────────────────────────────────────────────────────

  const enterEditMode = useCallback(() => {
    const currentFocus = focusedIdRef.current;
    setPreEditBubbles(bubblesRef.current.map(b => ({ ...b })));
    setEditMode(true);
    setEditingId(null);
    setEditSelection(null);
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
  }, []);

  const cancelEditMode = useCallback(() => {
    if (preEditBubbles) setBubbles(preEditBubbles);
    setPreEditBubbles(null);
    setEditMode(false);
    setEditingId(null);
    setEditSelection(null);
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
      // quickCreate wasn't checked here at all, so pressing Escape while its
      // panel was open fell through to the focusedId branch below and stepped
      // out of the current bubble instead — a confusing side effect entirely
      // unrelated to the open panel. Same cleanup as onContainerDown's
      // background-click-to-cancel and cancelQuickCreate below: drop the
      // placeholder bubble this quick-create session added.
      if (quickCreate)  { setBubbles(prev => prev.filter(b => b.id !== quickCreate.id)); setQuickCreate(null); return; }
      if (showAddPanel) { setShowAddPanel(false); return; }
      if (focusedId)    { stepOut(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [editingId, editMode, quickCreate, showAddPanel, focusedId, cancelEditMode, stepOut, setBubbles]);

  // -- Hold Tab to hide every label -----------------------------------------
  //
  // Momentary, never a toggle. The value is in the comparison - press to see
  // the map as shape and colour, release to get the words back - and a
  // momentary key also means there is no state to get stranded in and no
  // second control needed to undo it.
  //
  // Tab is the browser's focus key, so keydown MUST preventDefault: otherwise
  // holding it walks the focus ring through every button on the page while the
  // user is looking at the canvas. The typing guard hands Tab back to text
  // fields, where moving between inputs is exactly what the key is for.

  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el || typeof el.tagName !== 'string') return false;
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
    };
    const down = (e: KeyboardEvent) => {
      // Ctrl/Cmd/Alt+Tab belong to the OS and the browser - never shadow them.
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;
      // Auto-repeat fires this many times a second, and every one of those
      // still has to be swallowed or focus walks anyway.
      e.preventDefault();
      if (e.repeat) return;
      setTextHidden(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      setTextHidden(false);
    };
    // Anything that steals focus mid-hold - Alt+Tab, a click into devtools,
    // switching browser tab - swallows the keyup that would bring the text
    // back, leaving a permanently blank canvas. These put it back.
    const restore = () => setTextHidden(false);

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', restore);
    document.addEventListener('visibilitychange', restore);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', restore);
      document.removeEventListener('visibilitychange', restore);
    };
  }, []);

  // ── Pan / Pinch-to-zoom ──────────────────────────────────────────────────

  // Track every active pointer by id so we can distinguish single-finger pan
  // from two-finger pinch. The map is keyed by pointerId.
  const activePointers  = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPinchDist   = useRef<number | null>(null);

  // stepOut() used to fire on pointer-DOWN, making panning while focused
  // impossible. It's now decided on pointer-UP via isBackgroundTap — see
  // ../lib/dragHelpers for the tap-vs-pan discrimination and its tests.
  const backgroundPress = useRef<{ x: number; y: number; time: number; multi: boolean } | null>(null);

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
      // First finger — dismiss rename/edit-selection immediately (that part
      // was never the pan problem), but defer the focused/stepOut decision
      // until release so a pan isn't pre-empted.
      if (editingId) { setEditingId(null); return; }
      if (editMode && editSelection) { setEditSelection(null); return; }
      backgroundPress.current = { x: e.clientX, y: e.clientY, time: Date.now(), multi: false };
    } else if (activePointers.current.size === 2) {
      // Second finger — seed the pinch distance; single-pan stops naturally
      // because onContainerMove guards on pointer count. A gesture that
      // becomes a pinch must never resolve as a stepOut tap on release.
      if (backgroundPress.current) backgroundPress.current.multi = true;
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
      // Single-finger pan.
      // Touch pointers are panned directly by the touchmove listener instead:
      // on iOS Safari, preventDefault() in touchstart suppresses pointer events
      // so the touchmove handler is the only reliable path. On non-iOS browsers
      // both fire, but we let touchmove own it here to avoid double-counting.
      if (e.pointerType !== 'touch') {
        cameraX.set(cameraX.get() + e.clientX - prev.x);
        cameraY.set(cameraY.get() + e.clientY - prev.y);
      }
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

    const press = backgroundPress.current;
    if (press) {
      backgroundPress.current = null;
      const wasTap = isBackgroundTap(
        press.x, press.y, press.time, e.clientX, e.clientY, Date.now(), press.multi,
      );
      if (wasTap && focusedId) stepOut();
    }
  };

  // ── Zoom ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // A wheel over a scrollable panel belongs to that panel, not the camera.
      // preventDefault() used to run unconditionally here, so scrolling inside
      // the Add or Settings panel silently zoomed the canvas instead and the
      // panel's own content could never be reached. The touch path already
      // made this distinction; the wheel path did not.
      if (isInScrollable(e.target, el)) return;

      e.preventDefault();
      // Zoom stays available in edit mode. Blocking it meant you could not get
      // close enough to work on a small bubble, nor far enough out to see what
      // you were rearranging — precisely when you most need to.
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
    // non-passive listener.
    //
    // Strategy:
    //   • Multi-touch (≥2 fingers): always prevent — pointer events handle pinch.
    //   • Single-finger: prevent on the canvas background so panning never
    //     accidentally scrolls the page. But if the finger started inside a
    //     scrollable child (e.g. a long bubble label), let native scroll through.
    //
    // We track whether each single-touch sequence began in a scrollable child
    // via a plain object captured in the closure so touchmove can consult it.
    // touchState is recreated each time this effect runs, so closures inside
    // onTouchStart / onTouchMove always see the same object reference.
    const touchState = { inScrollable: false, lastX: 0, lastY: 0 };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
        return;
      }
      // Shared with the wheel handler so both agree on what counts as "this
      // gesture belongs to a panel, not the canvas".
      const inScrollable = isInScrollable(e.target, el);
      touchState.inScrollable = inScrollable;
      // Suppress the event for canvas-background touches so iOS never scrolls
      // the page during a one-finger pan.
      if (!inScrollable) {
        e.preventDefault();
        // Seed starting position so onTouchMove can compute deltas directly.
        // This is the primary pan path on iOS Safari: calling preventDefault()
        // in touchstart suppresses the pointer events that onContainerMove
        // depends on, so we must drive panning from touch events instead.
        touchState.lastX = e.touches[0].clientX;
        touchState.lastY = e.touches[0].clientY;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
        return;
      }
      // Carry forward the decision made at touchstart.
      if (!touchState.inScrollable) {
        e.preventDefault();
        // Drive pan directly from touch events so it works even when iOS has
        // suppressed the pointer events. On non-iOS browsers where pointer
        // events still fire alongside touch events, onContainerMove skips the
        // pan step for touch pointers (checked via e.pointerType === 'touch')
        // so there is no double-counting.
        const t = e.touches[0];
        cameraX.set(cameraX.get() + t.clientX - touchState.lastX);
        cameraY.set(cameraY.get() + t.clientY - touchState.lastY);
        touchState.lastX = t.clientX;
        touchState.lastY = t.clientY;
      }
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
            return applyChildDrag(b, dragOrigin.current.rx, dragOrigin.current.ry, sdx, sdy, parentPos, band);
          }
          // Root / focused bubble: free world movement.
          return applyRootDrag(b, dragOrigin.current.bx, dragOrigin.current.by, sdx, sdy);
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
            const cr = sizeForDepth(depth) / 2;
            const R = ringRadius(getSize(parent) / 2, cr, siblings.length + 1,
              Math.max(cr, ...siblings.map(s => getSize(s) / 2)));
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
    renameBubble(id, editValue);
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

  // addBubble is provided by useBubbleState.

  // ── Recolor a pillar ─────────────────────────────────────────────────────
  // A pillar's color is the identity of its whole branch, so every descendant
  // inherits it. Duplicate-checking happens inside the picker.
  //
  // Persistence contract: both recolor handlers write through setBubbles so the
  // useBubbleState persistence effect fires and saves the new color to
  // localStorage on every change. Do NOT update a MotionValue or local state
  // instead — that would bypass the effect and silently lose the change on refresh.

  const recolorPillar = (id: string, color: string) => {
    const family = new Set<string>([id, ...descendantsOf(id)]);
    setBubbles(prev => prev.map(b => (family.has(b.id) ? { ...b, color } : b)));
  };

  // ── Recolor a single bubble (depth 1+) ───────────────────────────────────
  // Below the pillar, color is per-bubble: it touches neither the parent nor
  // any child, so a branch can carry accents without losing its identity.
  // See persistence contract above — setBubbles is the only correct write path.

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
    deleteBubblesById(doomed);
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

      {/* Storage-near-limit banner — dismissible per session; re-appears if usage
          grows beyond the bytes recorded at dismissal, or when a save fails.
          Sits below the breadcrumb row (top-5) so the two never collide. */}
      {storageNearLimit && !saveFailedToast &&
        (dismissedAtBytes === null || lastSave.bytes > dismissedAtBytes) && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          className="absolute top-14 left-1/2 -translate-x-1/2 z-50 select-none text-center flex items-center gap-2"
          style={{ background: 'rgba(255,251,235,.95)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 20, padding: '9px 16px 9px 20px', boxShadow: '0 2px 20px rgba(0,0,0,.08),inset 0 0 0 1px rgba(180,140,30,.25)', fontSize: 12, color: 'hsl(38,60%,32%)', letterSpacing: '.03em', fontWeight: 300, maxWidth: 'calc(100vw - 32px)', whiteSpace: 'nowrap' }}>
          <span>☁ Your map is getting large — consider exporting or clearing unused branches</span>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={() => {
              const bytes = lastSave.bytes;
              setDismissedAtBytes(bytes);
              try { sessionStorage.setItem('mc_storageWarnDismissed', String(bytes)); } catch { /* ignore */ }
            }}
            style={{ marginLeft: 4, padding: '2px 8px', borderRadius: 12, border: '1px solid rgba(180,140,30,.35)', background: 'rgba(255,255,255,.5)', color: 'hsl(38,55%,30%)', fontSize: 11, cursor: 'pointer', fontWeight: 400, letterSpacing: '.02em', lineHeight: 1.6 }}>
            Got it
          </button>
        </motion.div>
      )}

      {/* Local save-failed toast */}
      {saveFailedToast && (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
          className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none select-none text-center"
          style={{ background: 'rgba(255,248,245,.94)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 20, padding: '9px 20px', boxShadow: '0 2px 20px rgba(0,0,0,.09),inset 0 0 0 1px rgba(200,80,60,.22)', fontSize: 12, color: 'hsl(12,55%,40%)', letterSpacing: '.03em', fontWeight: 300, maxWidth: 'calc(100vw - 32px)', whiteSpace: 'nowrap' }}>
          ⚠ Map could not be saved — storage may be full. Your changes exist until you refresh.
        </motion.div>
      )}

      {/* Cloud save-failed toast — shown when "Save canvas" fails, clears on the
          next successful save.

          The copy no longer says "make any edit to retry": under the manual-save
          model an edit never touches the network, so that instruction described
          behaviour that no longer exists and would have left the user editing
          away, believing a retry was queued. The only retry is Save canvas, and
          this toast is a button that opens Settings so it is one tap away. */}
      {!cloudSaveOk && !saveFailedToast && (
        <motion.button
          key="cloud-save-failed"
          type="button"
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
          whileHover={{ scale: 1.03 }} whileTap={{ scale: .98 }}
          onClick={() => setShowSettings(true)}
          className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 pointer-events-auto select-none text-center"
          style={{ background: 'rgba(255,248,245,.94)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 20, padding: '9px 20px', boxShadow: '0 2px 20px rgba(0,0,0,.09),inset 0 0 0 1px rgba(200,80,60,.22)', fontSize: 12, color: 'hsl(12,55%,40%)', letterSpacing: '.03em', fontWeight: 300, maxWidth: 'calc(100vw - 32px)', whiteSpace: 'nowrap' }}>
          {saveError === 'not-configured'
            ? '☁ No server configured — this canvas can’t be published. Tap for options.'
            : saveError === 'rejected'
              ? '☁ The server refused the save — your work is safe here. Tap to try again.'
              : '☁ Couldn’t reach the server — your work is safe here. Tap to try again.'}
        </motion.button>
      )}

      {/* Breadcrumb */}
      {!editMode && !textHidden && breadcrumb.length > 0 && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="absolute top-5 left-1/2 -translate-x-1/2 z-40 pointer-events-none select-none flex items-center gap-1.5"
          // maxWidth keeps a deep breadcrumb from sliding under the Settings
          // button at top-left (and its mirror on the right). Settings sits on
          // a higher z-index, so the collision was invisible: the crumb was
          // simply unclickable in that strip.
          style={{ background: 'rgba(255,255,255,.7)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 20, padding: '5px 16px', boxShadow: '0 2px 14px rgba(0,0,0,.05)', fontSize: 11.5, color: '#8b8b96', fontWeight: 300, letterSpacing: '.03em', maxWidth: 'calc(100vw - 320px)', overflow: 'hidden' }}>
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
            >
              {visualOnly ? (
                // Third layer is a bare presence marker: no label, no chrome.
                <div style={{
                  width: size, height: size, borderRadius: '50%',
                  background: bubble.color,
                  boxShadow: '0 1px 3px rgba(0,0,0,.20), inset 0 1px 1.5px rgba(255,255,255,.65)',
                }} />
              ) : (
                <GlassBubbleSVG size={size} color={bubble.color} label={bubble.label} cameraScale={cameraScale}
                  // A bubble being renamed keeps its field - blanking the text
                  // someone is actively typing into is never what they meant.
                  hideLabel={textHidden && editingId !== bubble.id}
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
                  counterScale={counterScale}
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
      {!focusedId && !editMode && !quickCreate && !showAddPanel && !textHidden && (
        <motion.p className="absolute top-20 left-1/2 -translate-x-1/2 text-gray-400 font-light text-xs tracking-widest pointer-events-none select-none whitespace-nowrap z-30"
          initial={{ opacity: 0 }} animate={{ opacity: .4 }} transition={{ delay: 1.5, duration: 1.5 }}>
          tap to enter · + to add bubbles · hold Tab to hide text
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

      {/* Hidden file input for import */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={async e => {
          const file = e.target.files?.[0];
          if (!file) return;
          // Reset so the same file can be re-selected if needed.
          e.target.value = '';
          const imported = await importBubbles(file);
          if (!imported) {
            window.alert('Could not read that file. Make sure it was exported from Mind Canvas.');
            return;
          }
          const count = imported.bubbles.length;
          const confirmed = window.confirm(
            `Replace the current canvas with the imported map?\n\n` +
            (imported.name ? `“${imported.name}” — ` : '') +
            `the imported file contains ${count} bubble${count === 1 ? '' : 's'}. ` +
            `Your current map will be replaced.`,
          );
          if (!confirmed) return;
          setBubbles(imported.bubbles);
          // Take the file's name, and clear the old one when it has none —
          // keeping the previous name would label imported content with a
          // title belonging to the map it just replaced.
          setCanvasName(imported.name ?? '');
          setFocusedId(null);
          setEditMode(false);
          setEditingId(null);
          setEditSelection(null);
          setQuickCreate(null);
          setShowAddPanel(false);
        }}
      />

      {/* Buttons */}
      {/* Hidden while Settings is open. On a short or narrow window the panel
          reaches down into this corner, so these buttons sat on top of it and
          took the taps meant for the panel's own controls. */}
      <div className="absolute bottom-6 right-6 z-50 flex gap-3 pointer-events-auto"
        // Hidden whenever a panel is open. Every one of these overlays reaches
        // into this corner, so leaving the buttons up put Edit and Add bubble
        // on top of the panel's own controls — covering them and taking their
        // clicks. Settings alone was not enough; the Add panel is taller.
        style={{ display: (showSettings || showAddPanel || quickCreate) ? 'none' : undefined }}
        onPointerDown={e => e.stopPropagation()}>
        {editMode ? (
          <>
            <motion.button style={pillBase}
              className="flex items-center gap-2 font-light text-gray-500"
              whileHover={{ scale: 1.04 }} whileTap={{ scale: .97 }}
              onClick={() => exportBubbles(bubbles, { name: canvasName || undefined })}>
              <span style={{ fontSize: 13, lineHeight: 1, opacity: .7 }}>↓</span> Export
            </motion.button>
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
          // Export / Import / Sync / Clear used to live here. Import and Export
          // are occasional, deliberate actions and moved into Settings; Clear
          // moved there too because a one-click canvas wipe next to the drawing
          // controls is an accident waiting to happen. Sync is gone entirely —
          // saving is explicit now, and a newer save announces itself.
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
          </>
        )}
      </div>

      {/* Settings (top-left). The unsaved dot is the only always-visible
          signal that work is unpublished — without it the manual-save model
          can lose an hour of edits with no warning at any point. */}
      {!editMode && !showSettings && (
        <div className="absolute top-6 left-6 z-50 pointer-events-auto"
          onPointerDown={e => e.stopPropagation()}>
          <motion.button style={pillBase}
            className="flex items-center gap-2 font-light text-gray-500 relative"
            whileHover={{ scale: 1.04 }} whileTap={{ scale: .97 }}
            aria-label={hasUnsavedChanges ? 'Settings — unsaved changes' : 'Settings'}
            onClick={e => { e.stopPropagation(); setShowSettings(true); }}>
            <span style={{ fontSize: 14, lineHeight: 1, opacity: .7 }}>⚙</span> Settings
            {hasUnsavedChanges && (
              <span aria-hidden="true" title="Unsaved changes"
                style={{
                  position: 'absolute', top: 7, right: 7, width: 8, height: 8,
                  borderRadius: '50%', background: 'hsl(35,85%,55%)',
                  boxShadow: '0 0 0 2px rgba(255,255,255,.9)',
                }} />
            )}
          </motion.button>
        </div>
      )}

      {showSettings && (
        <SettingsPanel
          canvasName={canvasName}
          onNameChange={setCanvasName}
          saving={saving}
          saveError={saveError}
          hasUnsavedChanges={hasUnsavedChanges}
          savedMeta={savedMeta}
          syncState={syncState}
          onSave={saveCanvas}
          onExport={() => exportBubbles(bubbles, { name: canvasName || undefined })}
          onImport={() => importInputRef.current?.click()}
          onClear={() => {
            const ok = window.confirm(
              'Erase this canvas?\n\n'
              + 'Every bubble is removed and the canvas goes back to the starter map. '
              + 'This cannot be undone, and the next save replaces the shared canvas '
              + 'on your app too. Export first if you want a copy.',
            );
            if (!ok) return;
            clearBubbles();
            setBubbles(INITIAL_BUBBLES);
            setCanvasName('');
            setFocusedId(null);
            setEditMode(false);
            setEditingId(null);
            setEditSelection(null);
            setQuickCreate(null);
            setShowAddPanel(false);
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Newer-save prompt */}
      {pendingSave && (
        <SaveAvailablePrompt
          savedAt={pendingSave.meta.savedAt}
          savedBy={pendingSave.meta.savedBy}
          name={pendingSave.meta.name}
          onAccept={acceptPendingSave}
          onDismiss={dismissPendingSave}
        />
      )}
    </div>
  );
}
