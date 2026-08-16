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
