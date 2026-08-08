import { BubbleData, MAX_DEPTH } from './bubbleTypes';
import { hslToHex } from './hslToHex';

export { MAX_DEPTH };

// ── Palette ───────────────────────────────────────────────────────────────────

const PILLAR_HSL: [number, number, number][] = [
  [250, 60, 58], [340, 64, 60], [170, 48, 46],
  [40,  72, 55], [205, 62, 55], [290, 54, 60],
  [8,   68, 57], [120, 42, 48],
];
const ROOT_HSL: [number, number, number][] = [
  [250, 60, 65], [340, 60, 65], [170, 40, 55],
  [40,  65, 65], [200, 55, 60], [290, 50, 66],
];

export const PILLAR_COLORS: string[] = PILLAR_HSL.map(([h, s, l]) => hslToHex(h, s, l));
export const ROOT_COLORS:   string[] = ROOT_HSL.map(([h, s, l]) => hslToHex(h, s, l));

export const SCALE_OPTIONS: number[] = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

// Gap between bubble edges in world units — matches web GAP = 9
export const GAP = 9;

// ── Sizing ────────────────────────────────────────────────────────────────────

const BASE_SIZES = [200, 160, 130, 110, 95, 82, 72, 64, 58, 52, 48];

export function sizeForDepth(depth: number): number {
  return BASE_SIZES[Math.min(depth, BASE_SIZES.length - 1)];
}
export function getSize(b: BubbleData): number {
  return sizeForDepth(b.depth) * (b.scale ?? 1.0);
}

// ── Three-layer display sizes (world units) ───────────────────────────────────
// Matches web exactly: LAYER_SIZE_OVERVIEW=[320,166,18], LAYER_SIZE_FOCUSED=[250,132,16]
export const LAYER_SIZES_OVERVIEW: [number, number, number] = [320, 166, 18];
export const LAYER_SIZES_FOCUSED:  [number, number, number] = [250, 132, 16];

// ── Ring geometry ─────────────────────────────────────────────────────────────

export function ringRadius(parentR: number, childR: number, n: number): number {
  const minGap = 12;
  if (n <= 1) return parentR + childR + minGap;
  const ringByAngle = (childR + minGap / 2) / Math.sin(Math.PI / n);
  return Math.max(parentR + childR + minGap, ringByAngle);
}

// ── Three-layer view ──────────────────────────────────────────────────────────

export function relativeLayer(
  bubbleId: string,
  focusedId: string | null,
  byId: Record<string, BubbleData>,
): number {
  const b = byId[bubbleId];
  if (!b) return -1;
  if (!focusedId) return b.depth <= 2 ? b.depth : -1;
  if (b.id === focusedId) return 0;
  if (b.parentId === focusedId) return 1;
  const parent = byId[b.parentId ?? ''];
  if (parent?.parentId === focusedId) return 2;
  return -1;
}

export function isInThreeLayerView(
  b: BubbleData,
  focusedId: string | null,
  byId: Record<string, BubbleData>,
): boolean {
  return relativeLayer(b.id, focusedId, byId) >= 0;
}

/**
 * World-unit display size for the three-layer view.
 * Layer-2 pips are always the fixed pip size (never multiplied by bubble scale).
 */
export function getBubbleDisplaySize(
  b: BubbleData,
  focusedId: string | null,
  byId: Record<string, BubbleData>,
): number {
  const layer = relativeLayer(b.id, focusedId, byId);
  if (layer < 0) return 0;
  const sizes = focusedId ? LAYER_SIZES_FOCUSED : LAYER_SIZES_OVERVIEW;
  if (layer === 2) return sizes[2];                      // pip — never scaled
  return sizes[layer] * (b.scale ?? 1.0);
}

// ── Collision resolution ──────────────────────────────────────────────────────

/**
 * Port of the web's resolveCollisions.
 * Runs `iterations` pairwise-separation passes on all visible bubbles.
 * Radii are taken from getBubbleDisplaySize so rendered circles don't overlap.
 * The dragged bubble (if any) is treated as immovable (infinite mass).
 *
 * Returns a map of id → new {x, y} for every visible bubble whose position
 * changed. Bubbles not in the three-layer view are untouched.
 */
export function resolveCollisions(
  bubbles: BubbleData[],
  focusedId: string | null,
  byId: Record<string, BubbleData>,
  draggingId: string | null = null,
  iterations = 4,
): Record<string, { x: number; y: number }> {
  // Only consider visible bubbles
  const visible = bubbles.filter(b => isInThreeLayerView(b, focusedId, byId));
  if (visible.length < 2) return {};

  // Mutable position copy
  const pos: Record<string, { x: number; y: number }> = {};
  for (const b of visible) pos[b.id] = { x: b.x, y: b.y };

  // Radii in world units (from display sizes)
  const radii: Record<string, number> = {};
  for (const b of visible) {
    radii[b.id] = getBubbleDisplaySize(b, focusedId, byId) / 2;
  }

  const ids = visible.map(b => b.id);

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const ia = ids[i], ib = ids[j];
        const ra = radii[ia], rb = radii[ib];
        const minDist = ra + rb + GAP;

        const dx = pos[ib].x - pos[ia].x;
        const dy = pos[ib].y - pos[ia].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        if (dist >= minDist) continue;

        const overlap = minDist - dist;
        // Mass proportional to area → larger bubbles move less
        const ma = ra * ra, mb = rb * rb;
        const total = ma + mb;
        const aFixed = ia === draggingId;
        const bFixed = ib === draggingId;
        const fa = aFixed ? 0 : bFixed ? 1 : mb / total;
        const fb = bFixed ? 0 : aFixed ? 1 : ma / total;

        const nx = dx / dist, ny = dy / dist;
        pos[ia] = { x: pos[ia].x - nx * overlap * fa, y: pos[ia].y - ny * overlap * fa };
        pos[ib] = { x: pos[ib].x + nx * overlap * fb, y: pos[ib].y + ny * overlap * fb };
      }
    }
  }

  // Return only positions that actually moved
  const result: Record<string, { x: number; y: number }> = {};
  for (const b of visible) {
    const orig = { x: b.x, y: b.y };
    const res  = pos[b.id];
    if (Math.abs(res.x - orig.x) > 0.05 || Math.abs(res.y - orig.y) > 0.05) {
      result[b.id] = res;
    }
  }
  return result;
}

// ── Subtree helper ────────────────────────────────────────────────────────────

/** Returns IDs of every descendant of `id` (direct + deep). */
export function getAllDescendants(id: string, bubbles: BubbleData[]): string[] {
  const result: string[] = [];
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const b of bubbles) {
      if (b.parentId === cur) {
        result.push(b.id);
        queue.push(b.id);
      }
    }
  }
  return result;
}

// ── Initial bubbles ───────────────────────────────────────────────────────────

let _counter = 0;
function sid(): string { return `init${_counter++}`; }

export function buildInitialBubbles(): BubbleData[] {
  _counter = 0;
  const out: BubbleData[] = [];

  const roots = [
    { label: 'Career',   color: ROOT_COLORS[0] },
    { label: 'Personal', color: ROOT_COLORS[1] },
    { label: 'Projects', color: ROOT_COLORS[2] },
  ];
  const childDefs: Record<string, string[]> = {
    Career:   ['Goals', 'Skills', 'Network'],
    Personal: ['Health', 'Travel', 'Hobbies'],
    Projects: ['Ideas',  'Active', 'Done'],
  };
  const grandDefs: Record<string, string[]> = {
    Goals:  ['Q1', 'Q2'],
    Skills: ['Dev', 'Design'],
    Health: ['Fitness', 'Sleep'],
    Ideas:  ['App', 'Blog'],
  };

  roots.forEach((root, ri) => {
    const angle = (ri / roots.length) * Math.PI * 2 - Math.PI / 2;
    const R = 620;
    const rid = sid();
    out.push({ id: rid, depth: 0, label: root.label, color: root.color,
      x: Math.cos(angle) * R, y: Math.sin(angle) * R });

    const kids = childDefs[root.label] ?? [];
    const pr = sizeForDepth(0) / 2;
    const cr = sizeForDepth(1) / 2;
    const R1 = ringRadius(pr, cr, kids.length);

    kids.forEach((label, ki) => {
      const cAngle = angle + (ki - (kids.length - 1) / 2) * (Math.PI / 3);
      const cx = Math.cos(angle) * R + Math.cos(cAngle) * R1;
      const cy = Math.sin(angle) * R + Math.sin(cAngle) * R1;
      const cid = sid();
      out.push({ id: cid, depth: 1, parentId: rid, label, color: root.color, x: cx, y: cy });

      const gkids = grandDefs[label] ?? [];
      const gcr = sizeForDepth(2) / 2;
      const R2 = ringRadius(cr, gcr, gkids.length);
      gkids.forEach((glabel, gi) => {
        const gAngle = cAngle + (gi - (gkids.length - 1) / 2) * (Math.PI / 2.5);
        out.push({ id: sid(), depth: 2, parentId: cid, label: glabel, color: root.color,
          x: cx + Math.cos(gAngle) * R2, y: cy + Math.sin(gAngle) * R2 });
      });
    });
  });

  return out;
}
