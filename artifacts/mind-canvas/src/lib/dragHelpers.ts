// ─── Drag helpers ─────────────────────────────────────────────────────────────
// Pure functions that compute the BubbleData fields written on every
// pointer-move while dragging.  Extracted so the logic can be unit-tested
// without rendering the full canvas component tree.
//
// These are the same formulas used by onBubbleMove in MindCanvas.tsx; keeping
// them in one place means a change to the drag math is reflected in both the
// component and the persistence tests automatically.

import type { BubbleData } from '../persistence';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Computes the new world (x, y) for a ROOT bubble (depth 0 or focused bubble)
 * after the pointer has moved by (sdx, sdy) in world space.
 *
 * @param originBx  — stored world-x at the moment of pointer-down
 * @param originBy  — stored world-y at the moment of pointer-down
 * @param sdx       — pointer ΔX / cameraScale
 * @param sdy       — pointer ΔY / cameraScale
 */
export function applyRootDrag(
  bubble: BubbleData,
  originBx: number,
  originBy: number,
  sdx: number,
  sdy: number,
): BubbleData {
  return { ...bubble, x: originBx + sdx, y: originBy + sdy };
}

/**
 * Computes the new angle + radial fraction for a CHILD bubble after the
 * pointer has moved by (sdx, sdy) in world space.
 *
 * The drag is resolved in rendered space (against the parent's current
 * rendered position) so the result survives the next animation frame rather
 * than being re-derived from world coords.
 *
 * @param bubble    — the child bubble being dragged
 * @param originRx  — rendered x of the child at pointer-down
 * @param originRy  — rendered y of the child at pointer-down
 * @param sdx       — pointer ΔX / cameraScale
 * @param sdy       — pointer ΔY / cameraScale
 * @param parentPos — current rendered position of the child's parent
 * @param band      — { minD, maxD } leash band returned by bandOf(bubble)
 */
export function applyChildDrag(
  bubble: BubbleData,
  originRx: number,
  originRy: number,
  sdx: number,
  sdy: number,
  parentPos: { x: number; y: number },
  band: { minD: number; maxD: number },
): BubbleData {
  const nrx  = originRx + sdx;
  const nry  = originRy + sdy;
  const dx2  = nrx - parentPos.x;
  const dy2  = nry - parentPos.y;
  const d    = Math.hypot(dx2, dy2) || 1;
  const span = Math.max(1, band.maxD - band.minD);
  return {
    ...bubble,
    angle:  Math.atan2(dy2, dx2),
    radial: clamp01((d - band.minD) / span),
  };
}
