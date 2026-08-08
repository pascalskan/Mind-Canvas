import { BubbleData, MAX_DEPTH } from './bubbleTypes';
import { hslToHex } from './hslToHex';

export { MAX_DEPTH };

// ── Palette (matches web app hsl values exactly) ─────────────────────────────

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

// ── Scale options ─────────────────────────────────────────────────────────────

export const SCALE_OPTIONS: number[] = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

// ── Sizing ────────────────────────────────────────────────────────────────────

// World-unit base size for each depth level. Camera starts at ~0.28 so these
// appear roughly 50-100 px on screen in the overview.
const BASE_SIZES = [200, 160, 130, 110, 95, 82, 72, 64, 58, 52, 48];

export function sizeForDepth(depth: number): number {
  return BASE_SIZES[Math.min(depth, BASE_SIZES.length - 1)];
}

export function getSize(b: BubbleData): number {
  return sizeForDepth(b.depth) * (b.scale ?? 1.0);
}

// Display sizes for the three-layer view (world units).
// These can differ from the stored bubble size so transitions feel smooth.
export const LAYER_SIZES_OVERVIEW: [number, number, number] = [180, 120, 50];
export const LAYER_SIZES_FOCUSED:  [number, number, number] = [220, 145, 55];

// ── Ring geometry ──────────────────────────────────────────────────────────────

/** Radius of the orbit ring for n children around a parent. */
export function ringRadius(parentR: number, childR: number, n: number): number {
  const minGap = 12;
  if (n <= 1) return parentR + childR + minGap;
  const ringByAngle = (childR + minGap / 2) / Math.sin(Math.PI / n);
  return Math.max(parentR + childR + minGap, ringByAngle);
}

// ── Three-layer view ──────────────────────────────────────────────────────────

/**
 * Returns which display layer a bubble occupies (0, 1, 2) or -1 if not visible.
 * Layer 0 = focused (or root in overview), 1 = children, 2 = grandchildren.
 */
export function relativeLayer(
  bubbleId: string,
  focusedId: string | null,
  byId: Record<string, BubbleData>,
): number {
  const b = byId[bubbleId];
  if (!b) return -1;

  if (!focusedId) {
    // Overview: show depth 0 / 1 / 2 only
    return b.depth <= 2 ? b.depth : -1;
  }

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

/** World-unit display size for the three-layer view. */
export function getBubbleDisplaySize(
  b: BubbleData,
  focusedId: string | null,
  byId: Record<string, BubbleData>,
): number {
  const layer = relativeLayer(b.id, focusedId, byId);
  if (layer < 0) return 0;
  const sizes = focusedId ? LAYER_SIZES_FOCUSED : LAYER_SIZES_OVERVIEW;
  return sizes[layer] * (b.scale ?? 1.0);
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
