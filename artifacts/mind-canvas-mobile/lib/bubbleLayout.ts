import { BubbleData, BubbleNote, MAX_DEPTH } from './bubbleTypes';
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

// Matches web exactly (SCALE_MIN/MAX/STEP in the web bubbleLayout.ts): a
// bubble scaled on one platform must have a corresponding, selectable chip on
// the other. Generated from the same three constants rather than hardcoded
// separately, so the two can't silently drift apart again — mobile used to
// hardcode 7 coarse steps ([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) while web had
// 20, so e.g. a bubble scaled to 0.3 on web showed no selected chip here and
// any tap coarsened it.
export const SCALE_MIN  = 0.1;
export const SCALE_MAX  = 2.0;
export const SCALE_STEP = 0.1;

export const SCALE_OPTIONS: number[] = Array.from(
  { length: Math.round((SCALE_MAX - SCALE_MIN) / SCALE_STEP) + 1 },
  (_, i) => Math.round((SCALE_MIN + i * SCALE_STEP) * 10) / 10,
);

// Gap between bubble edges in world units — matches web GAP = 9
export const GAP = 9;

// ── Sizing ────────────────────────────────────────────────────────────────────

const BASE_SIZES = [200, 160, 130, 110, 95, 82, 72, 64, 58, 52, 48];

export function sizeForDepth(depth: number): number {
  return BASE_SIZES[Math.min(depth, BASE_SIZES.length - 1)];
}
/** A bubble's manual scale, clamped to the range the UI actually offers. */
export function bubbleScale(b: BubbleData): number {
  const s = b.scale ?? 1;
  return Math.min(Math.max(s, SCALE_MIN), SCALE_MAX);
}

export function getSize(b: BubbleData): number {
  return sizeForDepth(b.depth) * bubbleScale(b);
}

// ── Layer-2 pip cluster ───────────────────────────────────────────────────────
// Kept identical to web (PIP_* in MindCanvas.tsx).
export const PIP_HOVER_GAP   = 14;                // world px between parent edge and pip
export const PIP_FAN_STEP    = 0.34;              // radians between adjacent pips
export const PIP_FAN_MAX_ARC = Math.PI * 1.25;    // total arc the fan may occupy

/**
 * Where a layer-2 indicator dot is DRAWN — which is deliberately not where the
 * bubble actually is.
 *
 * A pip exists to say "there is more inside this bubble". It is not a preview of
 * the layout underneath, so it ignores its own stored angle/radial and hovers in
 * a tight fan just off its parent, on the far side from the grandparent — the
 * dots point outward, away from where the user came from, so they read as
 * "further in" rather than scattering back across the parent.
 *
 * Nothing stored changes. Focus the parent and the same bubble becomes layer 1,
 * where its real position takes over again.
 */
export function pipDisplayPosition(
  parentX: number, parentY: number,
  parentDisplaySize: number, pipDisplaySize: number,
  ringIndex: number, ringSize: number,
  grandparent: { x: number; y: number } | null,
): { x: number; y: number } {
  const away = grandparent
    ? Math.atan2(parentY - grandparent.y, parentX - grandparent.x)
    : -Math.PI / 2;
  const step  = Math.min(PIP_FAN_STEP, PIP_FAN_MAX_ARC / Math.max(1, ringSize));
  const angle = away + (ringIndex - (ringSize - 1) / 2) * step;
  const r     = parentDisplaySize / 2 + pipDisplaySize / 2 + PIP_HOVER_GAP;
  return { x: parentX + Math.cos(angle) * r, y: parentY + Math.sin(angle) * r };
}

// ── Three-layer display sizes (world units) ───────────────────────────────────
// Matches web exactly: LAYER_SIZE_OVERVIEW=[320,166,18], LAYER_SIZE_FOCUSED=[250,132,16]
export const LAYER_SIZES_OVERVIEW: [number, number, number] = [320, 166, 18];
export const LAYER_SIZES_FOCUSED:  [number, number, number] = [250, 132, 16];

// ── Ring geometry ─────────────────────────────────────────────────────────────

/**
 * Ring radius that fits `n` children around a parent of radius `parentR`.
 *
 * `maxSiblingR` is the radius of the LARGEST child on the ring, which is what
 * the angular spacing actually has to clear. It differs from `childR` only when
 * siblings are scaled differently — and when it does, sizing the ring off
 * `childR` alone lets a small bubble compute a tight ring that its large
 * neighbour then overlaps. Defaults to `childR` for the uniform case.
 */
export function ringRadius(parentR: number, childR: number, n: number, maxSiblingR: number = childR): number {
  const minGap = 12;
  if (n <= 1) return parentR + childR + minGap;
  const biggest = Math.max(childR, maxSiblingR);
  const ringByAngle = (biggest + minGap / 2) / Math.sin(Math.PI / n);
  return Math.max(parentR + childR + minGap, ringByAngle);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The band a child may live in, measured in radii from its parent:
 *   minD    — touching its parent
 *   natural — where it sits if it has never been dragged
 *   maxD    — the end of its leash
 * Mirrors web's radialBand (MindCanvas.tsx) exactly, using this platform's
 * own ringRadius/GAP — see H3 in the audit for why this exists: web stores a
 * child's position as angle + a fraction of this band; without a matching
 * band on mobile, a `radial` value written by web had nothing to resolve
 * against here.
 */
export function radialBand(
  pr: number, cr: number, n: number, maxSiblingR: number = cr,
): { minD: number; maxD: number; natural: number } {
  const minD = pr + cr + GAP;
  const natural = ringRadius(pr, cr, n, maxSiblingR);
  const maxD = Math.max(natural + Math.max(40, pr * 0.9), minD + Math.max(48, pr * 1.6));
  return { minD, maxD, natural };
}

/**
 * angle + radial fraction for a child at world position (cx, cy) orbiting a
 * parent at (px, py), resolved against `band`. Mirrors web's applyChildDrag
 * (dragHelpers.ts) — the inverse of walking angle/radial back out to x/y.
 */
export function deriveAngleRadial(
  cx: number, cy: number, px: number, py: number,
  band: { minD: number; maxD: number },
): { angle: number; radial: number } {
  const dx = cx - px, dy = cy - py;
  const d = Math.hypot(dx, dy) || 1;
  const span = Math.max(1, band.maxD - band.minD);
  return { angle: Math.atan2(dy, dx), radial: clamp01((d - band.minD) / span) };
}

/**
 * A depth-based (not layer/focus-relative) band for a parent/child pair,
 * used specifically as the CANONICAL reference frame for angle/radial <->
 * x/y conversion outside of live rendering — see canonicalChildPosition.
 */
function canonicalBand(
  parent: BubbleData, child: BubbleData, siblingCount: number, maxSiblingR?: number,
) {
  // getSize, NOT sizeForDepth: the canonical band has to account for a bubble's
  // manual scale, exactly as the rendered sizing already does. Using the
  // unscaled depth size here meant enlarging a parent left its children
  // resolving to positions inside it, and enlarging a child pushed it through
  // its siblings — on both platforms, so sync propagated the overlap rather
  // than revealing it.
  return radialBand(getSize(parent) / 2, getSize(child) / 2, siblingCount, maxSiblingR);
}

/**
 * The canonical world (x, y) for a non-root bubble, derived from its stored
 * angle/radial against a DEPTH-based band (sizeForDepth, not the current
 * focus's layer-relative sizing) — the same reference frame buildInitialBubbles
 * and addBubble already seed positions in, so it's always computable
 * regardless of what's currently focused (layer-relative sizing only makes
 * sense for a bubble that's actually inside the current three-layer view).
 *
 * When angle is absent (never dragged, or written by an older client),
 * derives it from the stored x/y instead — mirrors web's `b.angle ?? computed`
 * fallback exactly, so a bubble that's never been touched keeps its seeded
 * direction rather than jumping.
 */
export function canonicalChildPosition(
  bubble: BubbleData,
  parent: BubbleData,
  ringIndex: number,
  ringSize: number,
  maxSiblingR?: number,
): { x: number; y: number; angle: number; radial: number } {
  const band = canonicalBand(parent, bubble, ringSize, maxSiblingR);
  const dx = bubble.x - parent.x, dy = bubble.y - parent.y;
  const angle = bubble.angle ?? (Math.hypot(dx, dy) > 1
    ? Math.atan2(dy, dx)
    : (ringIndex / ringSize) * Math.PI * 2 - Math.PI / 2);
  const span = Math.max(1, band.maxD - band.minD);
  const home = bubble.radial ?? clamp01((band.natural - band.minD) / span);
  const r = band.minD + span * clamp01(home);
  return {
    x: parent.x + Math.cos(angle) * r,
    y: parent.y + Math.sin(angle) * r,
    angle,
    radial: clamp01(home),
  };
}

/**
 * Recomputes x/y for every non-root bubble from its angle/radial (falling
 * back to deriving them from x/y when absent), depth-ascending so a parent's
 * corrected position is ready before its children need it.
 *
 * This is the mobile half of H3: it replaces the old grandchild-only,
 * fixed-fan-angle correctGrandchildPositions, generalized to every non-root
 * level and driven by the bubble's REAL angle/radial when one exists —
 * needed wherever mobile ingests bubbles it didn't compute itself (cloud
 * bootstrap, cross-device poll merge), since a web client's x/y for a child
 * is vestigial (web never writes it back after the first drag) while mobile
 * still reads x/y directly for its own rendering.
 */
export function syncPositionsFromAngleRadial(bubbles: BubbleData[]): BubbleData[] {
  const byId: Record<string, BubbleData> = {};
  for (const b of bubbles) byId[b.id] = b;

  const rings: Record<string, string[]> = {};
  for (const b of bubbles) {
    if (!b.parentId) continue;
    (rings[b.parentId] ??= []).push(b.id);
  }

  const ordered = [...bubbles].sort((a, b) => a.depth - b.depth);
  const resolved: Record<string, BubbleData> = {};
  let changed = false;

  for (const b of ordered) {
    const parent = b.parentId ? (resolved[b.parentId] ?? byId[b.parentId]) : null;
    if (!parent) {
      resolved[b.id] = b;
      continue;
    }
    const ring = rings[parent.id] ?? [b.id];
    const index = Math.max(0, ring.indexOf(b.id));
    // Size the ring against its largest member so mixed-scale siblings do not
    // overlap each other.
    const maxSiblingR = Math.max(...ring.map(id => getSize(byId[id] ?? b) / 2));
    const { x, y, angle, radial } = canonicalChildPosition(b, parent, index, ring.length, maxSiblingR);
    if (Math.abs(x - b.x) > 0.5 || Math.abs(y - b.y) > 0.5 || b.angle !== angle || b.radial !== radial) {
      changed = true;
      resolved[b.id] = { ...b, x, y, angle, radial };
    } else {
      resolved[b.id] = b;
    }
  }

  if (!changed) return bubbles;
  return bubbles.map(b => resolved[b.id] ?? b);
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

// ── Unsaved-changes fingerprint ───────────────────────────────────────────────

/**
 * A compact fingerprint of everything a save would capture: the canvas name
 * plus every persisted field of every bubble. Comparing this against the last
 * saved state is how "you have unsaved changes" is decided.
 *
 * Positions are rounded to whole units deliberately — sub-pixel drift from
 * layout settling is not a user edit, and rounding stops a canvas that is
 * merely re-deriving positions from reporting itself as modified.
 *
 * Kept byte-identical to the web implementation (useBubbleState.ts) so both
 * platforms agree on what "changed" means.
 */
/**
 * Notes folded into the fingerprint above.
 *
 * JSON rather than the surrounding `~`/`|` joins on purpose: note text is long
 * free-form writing and WILL eventually contain those delimiters, and a
 * delimiter collision here reads as "no change" — the unsaved dot stays dark
 * over work that was never published. JSON.stringify escapes them, and an
 * array-of-arrays has a fixed order, so web and mobile emit the same bytes.
 *
 * Must stay character-for-character identical to the web copy in
 * hooks/useBubbleState.ts — syncContract.test.ts asserts exactly that.
 */
export function notesSignature(notes?: BubbleNote[]): string {
  if (!notes || notes.length === 0) return '';
  return JSON.stringify(notes.map(n => [
    n.id, n.createdAt, n.text,
    // Rounded: a drag lands on fractional world units, and raw floats would
    // make two visually identical canvases hash differently.
    n.dx === undefined ? '' : Math.round(n.dx),
    n.dy === undefined ? '' : Math.round(n.dy),
  ]));
}

export function canvasSignature(bubbles: BubbleData[], name?: string): string {
  const parts = bubbles
    .map(b => [
      b.id, b.label, b.color, b.depth, b.parentId ?? '',
      Math.round(b.x), Math.round(b.y),
      b.angle?.toFixed(3) ?? '', b.radial?.toFixed(3) ?? '', b.scale ?? '',
      notesSignature(b.notes),
    ].join('~'))
    .sort();
  return `${name ?? ''}::${parts.join('|')}`;
}


// ── Label legibility ──────────────────────────────────────────────────────────
//
// Labels live in world space, so their on-screen size is (world size × camera
// scale) — unreadably small zoomed out, absurdly large zoomed in. These bounds
// clamp the RENDERED size instead: text still scales with the canvas through
// the comfortable middle, but stops shrinking and stops growing at the edges.
export const LABEL_MIN_PX = 11;
export const LABEL_MAX_PX = 22;
// Clamping alone would leave every distant bubble carrying a full-size label,
// which turns a zoomed-out canvas into overlapping text. So a label also fades
// out once its bubble is too small on screen to hold it — the bubble itself
// still reads as a shape, which is all it is at that distance.
export const LABEL_FADE_FROM_PX = 52;   // fully visible at or above this screen diameter
export const LABEL_FADE_TO_PX   = 28;   // fully transparent at or below

/**
 * How visible a label is at a given on-screen bubble diameter.
 *
 * Pillars are exempt. They are the map's fixed points — the thing you orient
 * by — so their names have to survive both the zoom-out fade and the hide-text
 * view; losing them leaves a screen of anonymous coloured circles.
 *
 * Both platforms call this so the same canvas reads the same way on each;
 * syncContract.test.ts asserts the two copies agree.
 */
export function labelZoomOpacity(diameterOnScreen: number, isPillar: boolean): number {
  if (isPillar) return 1;
  if (diameterOnScreen >= LABEL_FADE_FROM_PX) return 1;
  if (diameterOnScreen <= LABEL_FADE_TO_PX)   return 0;
  return (diameterOnScreen - LABEL_FADE_TO_PX) / (LABEL_FADE_FROM_PX - LABEL_FADE_TO_PX);
}

/**
 * True when a pillar's label can no longer fit INSIDE its own circle.
 *
 * Exempting pillars from the fade is not enough on its own: the font size has a
 * floor of LABEL_MIN_PX while the bubble keeps shrinking with the camera, so at
 * the far end of the zoom range a pillar is under 20px across carrying an 11px
 * label. Wrapped, that stacks several broken lines over a dot. At that range
 * the label stops wrapping and lies across the bubble instead — a coloured
 * marker with its name on it, which is all the label is doing that far out.
 */
export function pillarLabelIsCompact(diameterOnScreen: number, isPillar: boolean): boolean {
  return isPillar && diameterOnScreen < LABEL_FADE_FROM_PX;
}

// ── Breadcrumb labels ─────────────────────────────────────────────────────────

/**
 * How many levels the breadcrumb shows before collapsing the rest behind "…".
 * The trail answers "where am I", and the nearest few ancestors answer it; the
 * whole chain from the root just turns the bar into a second canvas.
 */
export const CRUMB_LIMIT = 3;

/**
 * Shortens one bubble label for the breadcrumb.
 *
 * A deep chain of full titles is what pushes the bar across the canvas. Letting
 * the container clip it instead is worse than it sounds: the crumb that gets
 * cut is the LAST one, which is the only one saying where you actually are. So
 * each crumb is shortened at the source, and the bar stays inside its bounds by
 * construction rather than by overflow.
 *
 * Whole words are kept wherever they fit — a word cut mid-way reads as a typo
 * rather than an abbreviation — and at most two of them, since a third rarely
 * adds recognition for its width. A single word longer than the budget still
 * has to be cut somewhere, and that is the one case where letters are dropped.
 *
 * Duplicated on web and mobile like the rest of this file; syncContract.test.ts
 * asserts the two copies agree.
 */
/**
 * Geometry of the breadcrumb bar, in the platform's own units.
 *
 * Web and mobile differ in font, padding and what chrome the bar carries, so
 * each measures itself; the arithmetic that spends the space is shared.
 */
export interface CrumbMetrics {
  /** Width the whole bar may occupy. */
  barWidth: number;
  /** Chrome present whatever happens — the bar's own padding, plus Home. */
  fixed: number;
  /** One separator chevron, including its margins. */
  chevron: number;
  /** Padding either side of one crumb's text. */
  crumbPadding: number;
  /** Anything the current crumb carries that ancestors do not (its dot). */
  currentExtra: number;
  /** The leading "…" standing in for levels not shown. */
  ellipsis: number;
  /** Average width of one character at the bar's font size. */
  charWidth: number;
  /** Below this a crumb says nothing worth the space it costs. */
  minChars: number;
  /** Past this a longer crumb only crowds its neighbours. */
  maxChars: number;
  /**
   * How much of the current bubble's name must survive before room is spent
   * on an older level at all. This is the rule that keeps the trail useful:
   * a third crumb is worth having only if it costs the name you are reading
   * nothing, because "where am I" is answered by the current bubble and its
   * parent, and everything above that is a bonus.
   */
  comfortChars: number;
}

export interface CrumbFit {
  /** How many of the newest levels to render. */
  count: number;
  /** Characters allowed to the bubble you are in. */
  currentChars: number;
  /** Characters allowed to each level above it. */
  ancestorChars: number;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(v)));
}

/**
 * Decides how much of the trail actually fits, rather than assuming.
 *
 * A fixed crumb count with fixed character budgets cannot work across a phone
 * and a desktop: whatever number suits one overflows or wastes the other. So
 * the bar measures itself and spends what it has.
 *
 * The current bubble and its parent are the pair that answers "where am I",
 * and they are never dropped. Anything older is a bonus, shown only when it
 * genuinely fits — a third crumb squeezed to four characters tells you less
 * than the "…" that replaces it.
 *
 * The current bubble takes a double share of the text room, because it is the
 * one being read; its ancestors only need to be recognisable.
 *
 * The returned budgets are a best estimate from an average character width, so
 * the renderers still cap each crumb to one line and let it ellipsize. This
 * decides what SHOULD fit; that stops an unusually wide label from overflowing anyway.
 */
export function fitCrumbs(total: number, m: CrumbMetrics): CrumbFit {
  if (total <= 0) return { count: 0, currentChars: 0, ancestorChars: 0 };

  const floorCount = Math.min(total, 2);
  const ceilCount  = Math.min(total, CRUMB_LIMIT);

  for (let count = ceilCount; count >= floorCount; count--) {
    const hidesOlder = total > count;
    const chrome =
      m.fixed
      + count * (m.chevron + m.crumbPadding)
      + m.currentExtra
      + (hidesOlder ? m.ellipsis + m.chevron : 0);

    // The current crumb counts twice, so `count + 1` shares in all.
    const perShare = (m.barWidth - chrome) / (count + 1) / m.charWidth;
    const currentChars  = clampInt(perShare * 2, m.minChars, m.maxChars);
    const ancestorChars = clampInt(perShare,     m.minChars, m.maxChars);

    // Take this many levels only if the bubble you are IN still reads
    // properly. Otherwise drop one and try again: an extra ancestor bought by
    // truncating the current name is a bad trade, and it was the trade the
    // fixed budgets kept making.
    if (currentChars >= m.comfortChars || count === floorCount) {
      return { count, currentChars, ancestorChars };
    }
  }

  // The loop always returns at floorCount; this only satisfies the compiler.
  return { count: floorCount, currentChars: m.minChars, ancestorChars: m.minChars };
}

export function abbreviateCrumb(labelText: string, maxChars: number): string {
  const clean = labelText.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxChars) return clean;

  let out = '';
  for (const word of clean.split(' ').slice(0, 2)) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > maxChars) break;
    out = next;
  }
  // Nothing fit: a first word wider than the whole budget.
  if (!out) out = clean.slice(0, Math.max(1, maxChars));
  return `${out}…`;
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
