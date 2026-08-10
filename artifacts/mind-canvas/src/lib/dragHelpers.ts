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

/**
 * Whether the per-frame rAF loop should write bubble positions into their
 * Framer MotionValues this tick.
 *
 * During a camera PAN or pinch, the world div's own MotionValue transform
 * already redraws every bubble for free, so per-bubble writes are skipped to
 * avoid two competing transform writes fighting each other on the same frame.
 *
 * A bubble DRAG also registers a pointer (so a second finger mid-drag can be
 * recognised as a pinch — see onBubbleDown), but it is NOT a pan: the camera
 * isn't moving, and this is the only place the dragged bubble's own position
 * gets written each frame. Gating purely on "is any pointer active" swallowed
 * those writes for the whole gesture, so the bubble only jumped to its final
 * position on release instead of following the pointer. Writes must still run
 * whenever a bubble is actively being dragged, regardless of pointer count.
 */
export function shouldWriteBubbleMotionValues(
  activePointerCount: number,
  draggingId: string | null,
): boolean {
  const isPanning = activePointerCount > 0 && draggingId === null;
  return !isPanning;
}

/**
 * Whether a background press/release pair should be treated as a tap (and so
 * step out of the focused bubble) rather than the start of a pan.
 *
 * stepOut() used to fire on pointer-DOWN, which made panning while focused
 * impossible — the first pixel of a pan was indistinguishable from a tap.
 * Deciding on release instead, gated by movement and duration, lets a real
 * tap still step out immediately while a pan is free to happen underneath it.
 * A gesture that ever became a pinch (a second finger joined) must never
 * resolve as a tap, regardless of how little the releasing finger moved.
 */
export function isBackgroundTap(
  startX: number, startY: number, startTime: number,
  endX: number, endY: number, endTime: number,
  wasMultiTouch: boolean,
  maxDist = 10, maxDurationMs = 280,
): boolean {
  if (wasMultiTouch) return false;
  const dist = Math.hypot(endX - startX, endY - startY);
  return dist < maxDist && endTime - startTime < maxDurationMs;
}

/**
 * IDs of every direct and transitive descendant of `id` — never including
 * `id` itself. Used for subtree drag, delete, and pillar recolor.
 *
 * A single pass builds a parent→children map (O(n)), then one traversal
 * visits each descendant exactly once (O(n) total). The previous version
 * re-scanned the entire bubble array on every pass of a fixed-point loop —
 * up to MAX_DEPTH passes for a maximally deep chain — which cost O(n·depth)
 * instead of O(n). Traversal uses an index pointer into a growing array
 * rather than Array.shift(), which is itself O(n) per call and would have
 * reintroduced the same quadratic cost through the back door.
 */
export function descendantsOf(bubbles: BubbleData[], id: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const b of bubbles) {
    if (!b.parentId) continue;
    const siblings = childrenOf.get(b.parentId);
    if (siblings) siblings.push(b.id);
    else childrenOf.set(b.parentId, [b.id]);
  }

  const ids = new Set<string>();
  const queue = [...(childrenOf.get(id) ?? [])];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (ids.has(cur)) continue; // defensive: a cyclic graph must not loop forever
    ids.add(cur);
    const kids = childrenOf.get(cur);
    if (kids) queue.push(...kids);
  }
  return ids;
}
