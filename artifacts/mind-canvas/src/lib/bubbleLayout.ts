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

export function getSize(b: BubbleData): number {
  return sizeForDepth(b.depth);
}

// Ring radius that fits `n` circles of radius `cr` around a parent of radius `pr`
// without the siblings touching each other.
export function ringRadius(pr: number, cr: number, n: number): number {
  const touching = pr + cr + GAP + cr * 0.55 + 12;
  if (n <= 1) return touching;
  const spacing = (cr + GAP / 2) / Math.sin(Math.PI / n);
  return Math.max(touching, spacing);
}
