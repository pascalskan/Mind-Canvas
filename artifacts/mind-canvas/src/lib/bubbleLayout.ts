// ─── Shared layout constants & pure geometry ─────────────────────────────────
// Extracted so both MindCanvas.tsx and useBubbleState.ts can import them without
// creating a circular dependency through the component file.

import type { BubbleData } from '../persistence';

export const MAX_DEPTH = 10;
export const GAP       = 9;   // minimum breathing room between any two bubbles

export const DEPTH_SIZE = [320, 166, 112, 84, 68, 58, 52, 47, 43, 40, 37];

export const SCALE_MIN  = 0.1;
export const SCALE_MAX  = 2.0;
export const SCALE_STEP = 0.1;

export const ROOT_COLORS = [
  'hsl(250,60%,65%)', 'hsl(340,60%,65%)', 'hsl(170,40%,55%)',
  'hsl(40,65%,65%)',  'hsl(200,55%,60%)', 'hsl(290,50%,66%)',
];

export function sizeForDepth(depth: number): number {
  return DEPTH_SIZE[Math.min(depth, DEPTH_SIZE.length - 1)];
}

/** A bubble's manual scale, clamped to the range the UI actually offers. */

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

// ── Completion ────────────────────────────────────────────────────────────────

/**
 * The beats of the completion animation, shared so both platforms play the
 * same one and both delay the archive write by the same total.
 */
export const COMPLETE_FADE_MS  = 320;   // the glass empties out
export const COMPLETE_FILL_MS  = 760;   // colour rises to the brim
export const COMPLETE_POP_MS   = 300;   // and it goes
export const COMPLETE_TOTAL_MS = COMPLETE_FADE_MS + COMPLETE_FILL_MS + COMPLETE_POP_MS;

/** How much of the bubble's own colour survives in an archived fill / rim. */
export const ARCHIVE_FILL_KEEP = 0.15;
export const ARCHIVE_RING_KEEP = 0.55;

/** r,g,b 0-255 from an `hsl()` string or a `#hex`, or null if neither. */
function toRgb(color: string): [number, number, number] | null {
  const hex = color.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    const raw = hex[1]!;
    const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  const hsl = color.trim().match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i);
  if (hsl) {
    const h = parseFloat(hsl[1]!);
    const s = parseFloat(hsl[2]!) / 100;
    const l = parseFloat(hsl[3]!) / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)));
    };
    return [f(0), f(8), f(4)];
  }
  return null;
}

/**
 * A bubble's colour mixed toward white, for drawing archived work.
 *
 * Written out by hand rather than left to CSS `color-mix` because the two
 * clients do not even store colour the same way — the website writes
 * `hsl(250,60%,65%)` and the app writes `#8a7ad6` — and both formats travel in
 * the same synced map. A bubble made on one device and archived on the other
 * has to come out the same shade either way, which means one function that
 * understands both.
 *
 * `keep` is how much of the original survives: 0 is white, 1 is untouched.
 * An unrecognised format is returned as-is rather than guessed at.
 */
export function archiveWash(color: string, keep: number): string {
  const rgb = toRgb(color);
  if (!rgb) return color;
  const mix = (c: number) => Math.round(c * keep + 255 * (1 - keep));
  return `rgb(${mix(rgb[0])}, ${mix(rgb[1])}, ${mix(rgb[2])})`;
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

export function bubbleScale(b: BubbleData): number {
  const s = b.scale ?? 1;
  return Math.min(Math.max(s, SCALE_MIN), SCALE_MAX);
}

/**
 * A bubble's diameter in canonical (depth-based) space, INCLUDING its manual
 * scale.
 *
 * The scale term is not cosmetic. This function feeds the geometry that decides
 * where a child is seeded and where its stored angle/radial resolves to, while
 * rendering used a separate, scale-aware size — so the two disagreed the moment
 * anyone resized a bubble. Enlarging a parent left its children seeded at the
 * unscaled radius, i.e. inside it; enlarging a child pushed it through its
 * siblings. Both platforms had the same blind spot, so it survived sync too.
 */
export function getSize(b: BubbleData): number {
  return sizeForDepth(b.depth) * bubbleScale(b);
}

/**
 * Ring radius that fits `n` circles around a parent of radius `pr` without the
 * siblings touching each other.
 *
 * `cr` is this child's radius; `maxSiblingR` is the radius of the LARGEST child
 * on the ring, which is what the angular spacing actually has to clear. They
 * differ only when siblings are scaled differently — and when they do, sizing
 * the ring off `cr` alone lets a small bubble compute a tight ring that its
 * large neighbour then overlaps. Defaults to `cr` for the uniform case.
 */
export function ringRadius(pr: number, cr: number, n: number, maxSiblingR: number = cr): number {
  const biggest = Math.max(cr, maxSiblingR);
  const touching = pr + cr + GAP + cr * 0.55 + 12;
  if (n <= 1) return touching;
  // Two adjacent circles of radius `biggest` sitting 2π/n apart on the ring
  // need this much radius to keep a GAP between them.
  const spacing = (biggest + GAP / 2) / Math.sin(Math.PI / n);
  return Math.max(touching, spacing);
}
