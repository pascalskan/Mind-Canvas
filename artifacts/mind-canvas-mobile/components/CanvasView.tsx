import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useBubbles } from '@/context/BubbleContext';
import { BubbleNode } from '@/components/BubbleNode';
import { CanvasBackground } from '@/components/CanvasBackground';
import {
  getBubbleDisplaySize, isInThreeLayerView, relativeLayer,
  getAllDescendants, resolveCollisions, ringRadius, getSize, bubbleScale, pipDisplayPosition,
  LAYER_SIZES_OVERVIEW, LAYER_SIZES_FOCUSED, sizeForDepth,
  radialBand, deriveAngleRadial,
} from '@/lib/bubbleLayout';
import { BubbleData } from '@/lib/bubbleTypes';

const INIT_SCALE   = 0.28;
const MIN_SCALE    = 0.06;
const MAX_SCALE    = 5.0;
const TAP_DIST      = 10;
const TAP_MS        = 280;
const DRAG_THRESH   = 6;
const LONG_PRESS_MS = 500;
const DOUBLE_TAP_MS = 320;

interface Camera { x: number; y: number; scale: number }

function toScreen(wx: number, wy: number, cam: Camera) {
  return { sx: wx * cam.scale + cam.x, sy: wy * cam.scale + cam.y };
}
function toWorld(sx: number, sy: number, cam: Camera) {
  return { wx: (sx - cam.x) / cam.scale, wy: (sy - cam.y) / cam.scale };
}

function fitBounds(
  sw: number, sh: number,
  minX: number, maxX: number, minY: number, maxY: number,
  pad = 90, maxScale = 0.9,
): Camera {
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const scale = Math.min(sw / w, sh / h, maxScale);
  const midX  = (minX + maxX) / 2;
  const midY  = (minY + maxY) / 2;
  return { x: sw / 2 - midX * scale, y: sh / 2 - midY * scale, scale };
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

/**
 * Snap a dragged bubble's world position onto the ring it orbits around its
 * parent. Returns the constrained (x, y); unchanged if the bubble has no parent.
 */
function constrainToParentRing(
  newWX: number,
  newWY: number,
  dragged: BubbleData,
  byId: Record<string, BubbleData>,
  bubbles: BubbleData[],
  focusedId: string | null,
): { x: number; y: number } {
  const parent = byId[dragged.parentId ?? ''];
  if (!parent) return { x: newWX, y: newWY };

  const sizes  = focusedId ? LAYER_SIZES_FOCUSED : LAYER_SIZES_OVERVIEW;
  const pLayer = focusedId
    ? relativeLayer(parent.id, focusedId, byId)
    : parent.depth <= 2 ? parent.depth : -1;
  const cLayer = pLayer >= 0 ? pLayer + 1 : -1;
  // Layer sizes carry the bubble's manual scale, matching how it is actually
  // drawn — a leash computed from the unscaled size let an enlarged bubble be
  // dragged inside its own parent.
  const pr = pLayer >= 0 && pLayer <= 2 ? (sizes[pLayer] * bubbleScale(parent)) / 2 : getSize(parent) / 2;
  const cr = cLayer >= 0 && cLayer <= 2 ? (sizes[cLayer] * bubbleScale(dragged)) / 2 : getSize(dragged) / 2;
  // +1 to include the dragged bubble itself in sibling count
  const otherSibs = bubbles.filter(b => b.parentId === dragged.parentId && b.id !== dragged.id);
  const sibCount = otherSibs.length + 1;
  const rr       = ringRadius(pr, cr, sibCount, Math.max(cr, ...otherSibs.map(s => getSize(s) / 2)));

  const dx    = newWX - parent.x;
  const dy    = newWY - parent.y;
  const angle = Math.atan2(dy, dx);
  return { x: parent.x + Math.cos(angle) * rr, y: parent.y + Math.sin(angle) * rr };
}

const PIP_EASE_MS = 420;   // focus-change travel for the pip cluster

const PHYS_GAP = 12;       // min gap between bubble edges, world units

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  /** Called when the user long-presses a bubble to add a child to it. */
  onLongPressAddChild?: (parentId: string) => void;
  /** Called when the user double-taps a bubble to rename it. */
  onDoubleTapBubble?: (id: string) => void;
  /** Hide-text view: every label fades off the canvas, the bubbles stay. */
  hideText?: boolean;
}

export default function CanvasView({ onLongPressAddChild, onDoubleTapBubble, hideText }: Props) {
  const {
    bubbles, focusedId, editMode, editSelection, byId, showArchived, completingId,
    setFocusedId, setEditSelection, updateBubblePosition,
    batchUpdatePositions, resyncPositions, noteInteraction,
  } = useBubbles();

  // useWindowDimensions (not a module-level Dimensions.get() snapshot) so a
  // rotation or, on react-native-web, a browser resize is actually reflected —
  // previously SW/SH were captured once at module load and never updated, so
  // the initial camera position and every fitBounds() call (below, and in the
  // camera-fit-on-focus effect) stayed sized for whatever the viewport was at
  // first mount. The pan/pinch gesture math doesn't need this: it works in
  // relative touch deltas against the camera's own x/y/scale, not against
  // absolute screen dimensions.
  const dims = useWindowDimensions();

  // ── Hide-text fade ──────────────────────────────────────────────────────────
  // One Animated.Value shared by every label on the canvas, so they leave and
  // return together instead of each bubble cutting on its own re-render. 180ms
  // matches the web's hold-Tab fade; native-driven, so a canvas mid-pan does
  // not stutter while the text goes.
  const labelReveal = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.timing(labelReveal, {
      toValue: hideText ? 0 : 1,
      duration: 180,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [hideText, labelReveal]);

  // ── Camera ──────────────────────────────────────────────────────────────────
  const cameraRef  = useRef<Camera>({ x: dims.width / 2, y: dims.height / 2, scale: INIT_SCALE });
  const [camera, setCamera] = useState<Camera>({ x: dims.width / 2, y: dims.height / 2, scale: INIT_SCALE });

  /**
   * Last line of defence for the camera. A non-finite x/y/scale is
   * unrecoverable: it propagates into every bubble's rendered size and
   * position, React Native throws on NaN layout values, the ErrorBoundary
   * takes over and the only way out is reloadAppAsync() — the "app errors and
   * needs a hard refresh" symptom. Worse, drag math divides by camera scale,
   * so a poisoned camera writes NaN into bubble x/y, which JSON-serialises to
   * null and corrupts the shared cloud map for every device.
   *
   * The specific known trigger (two touches landing on the same pixel, making
   * pinch compute 0/0) is fixed at source in onPanResponderMove, but a clamp
   * of Math.max(MIN, Math.min(MAX, NaN)) is still NaN, so any future
   * arithmetic slip would silently poison the camera the same way. Rejecting
   * the update outright means a bad frame is simply ignored instead.
   */
  function applyCameraImmediate(cam: Camera) {
    if (!Number.isFinite(cam.x) || !Number.isFinite(cam.y) || !Number.isFinite(cam.scale) || cam.scale <= 0) {
      return;
    }
    cameraRef.current = cam;
    setCamera({ ...cam });
  }

  const animFrameRef = useRef<number>(0);
  function animateCamera(target: Camera) {
    cancelAnimationFrame(animFrameRef.current);
    const step = () => {
      const cur  = cameraRef.current;
      const t    = 0.18;
      const next: Camera = {
        x:     lerp(cur.x,     target.x,     t),
        y:     lerp(cur.y,     target.y,     t),
        scale: lerp(cur.scale, target.scale, t),
      };
      const done =
        Math.abs(next.x - target.x) < 0.3 &&
        Math.abs(next.y - target.y) < 0.3 &&
        Math.abs(next.scale - target.scale) < 0.001;
      const final = done ? target : next;
      cameraRef.current = final;
      setCamera({ ...final });
      if (!done) animFrameRef.current = requestAnimationFrame(step);
    };
    animFrameRef.current = requestAnimationFrame(step);
  }
  useEffect(() => () => cancelAnimationFrame(animFrameRef.current), []);
  useEffect(() => () => { if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current); }, []);

  // ── Stale-closure-safe refs ──────────────────────────────────────────────────
  const bubblesRef    = useRef(bubbles);   bubblesRef.current    = bubbles;
  const focusedIdRef  = useRef(focusedId); focusedIdRef.current  = focusedId;
  const editModeRef   = useRef(editMode);  editModeRef.current   = editMode;
  const editSelRef    = useRef(editSelection); editSelRef.current = editSelection;
  const byIdRef       = useRef(byId);      byIdRef.current       = byId;
  const updatePosRef  = useRef(updateBubblePosition); updatePosRef.current = updateBubblePosition;
  const batchUpdateRef = useRef(batchUpdatePositions); batchUpdateRef.current = batchUpdatePositions;
  const setFocusedRef = useRef(setFocusedId); setFocusedRef.current = setFocusedId;
  const setEditSelRef = useRef(setEditSelection); setEditSelRef.current = setEditSelection;
  const onLongPressRef        = useRef(onLongPressAddChild); onLongPressRef.current        = onLongPressAddChild;
  const onDoubleTapRef        = useRef(onDoubleTapBubble);  onDoubleTapRef.current        = onDoubleTapBubble;
  const resyncPositionsRef  = useRef(resyncPositions);  resyncPositionsRef.current  = resyncPositions;

  // Tracks the last bubble tap for double-tap detection.
  const lastTapRef = useRef<{ id: string | null; time: number }>({ id: null, time: 0 });
  // The first tap of a double-tap is indistinguishable from a standalone tap
  // until the second one (or its absence) is observed, so the single-tap
  // action is deferred by DOUBLE_TAP_MS and only fires if no second tap
  // arrives in time. Without this, every double-tap ALSO fired the single-tap
  // focus/zoom action first (see handleBubbleTap), so double-tapping to
  // rename always zoomed the camera in before the editor opened.
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Physics collision resolution ─────────────────────────────────────────────
  // Working positions during animation; seeded once when a single bubble is
  // added, then settled frame-by-frame by the collision resolver.
  const physicsPos    = useRef<Record<string, { x: number; y: number }>>({});
  const physicsRaf    = useRef(0);
  const prevBubbleIds = useRef<Set<string>>(new Set());

  // Trigger a re-render each physics frame without heavy state churn.
  const [, forcePhysicsTick] = React.useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const currentIds = new Set(bubbles.map(b => b.id));
    const prev       = prevBubbleIds.current;

    // Only run physics when exactly ONE new bubble was added and nothing removed.
    // Bulk loads (hydration, import) or deletions are excluded.
    const addedIds     = [...currentIds].filter(id => !prev.has(id));
    const removedCount = [...prev].filter(id => !currentIds.has(id)).length;
    prevBubbleIds.current = currentIds;

    if (addedIds.length !== 1 || removedCount !== 0) return;

    // Seed working positions from current bubble state.
    const pos: Record<string, { x: number; y: number }> = {};
    for (const b of bubbles) pos[b.id] = { x: b.x, y: b.y };
    physicsPos.current = pos;
    cancelAnimationFrame(physicsRaf.current);

    let frame = 0;

    function commitAndClear() {
      const cur = bubblesRef.current;
      const p   = physicsPos.current;
      const updates: { id: string; x: number; y: number }[] = [];
      for (const b of cur) {
        const np = p[b.id];
        if (np && (Math.abs(np.x - b.x) > 0.5 || Math.abs(np.y - b.y) > 0.5)) {
          updates.push({ id: b.id, x: np.x, y: np.y });
        }
      }
      if (updates.length) batchUpdateRef.current(updates);
      physicsPos.current = {};
    }

    const tick = () => {
      frame++;
      const cur      = bubblesRef.current;
      const bid      = byIdRef.current;
      const p        = physicsPos.current;
      const dragging = draggingIdRef.current;

      const maxDisp = resolveCollisionsStep(cur, p, bid, focusedIdRef.current, dragging);
      forcePhysicsTick();

      if (maxDisp < PHYS_SETTLE || frame >= PHYS_MAX_FRAMES) {
        commitAndClear();
        return;
      }
      physicsRaf.current = requestAnimationFrame(tick);
    };

    physicsRaf.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(physicsRaf.current);
      // Commit only when physicsPos is non-empty. onPanResponderGrant clears
      // it eagerly on drag start so cleanup sees an empty map on drag-end and
      // cannot overwrite the dropped position.
      if (Object.keys(physicsPos.current).length > 0) {
        commitAndClear();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubbles]);

  // ── Visible bubbles ──────────────────────────────────────────────────────────
  const visibleBubbles = useMemo(
    () => bubbles.filter(b => isInThreeLayerView(b, focusedId, byId)),
    [bubbles, focusedId, byId],
  );
  const visibleRef = useRef(visibleBubbles); visibleRef.current = visibleBubbles;

  // ── Display positions for layer-2 pips ──────────────────────────────────────
  //
  // A pip is drawn beside its parent rather than at its real position (see
  // pipDisplayPosition). That means focusing a bubble moves its children from
  // the cluster out to where they actually live — a jump, unless it is eased.
  //
  // The ease is a BOUNDED animation that runs only on a focus change and stops
  // when it settles. Mobile deliberately has no continuous layout loop, and
  // this does not add one: it is idle except for the few hundred milliseconds
  // after you tap in or out.
  const pipTargets = useCallback((focus: string | null) => {
    const out: Record<string, { x: number; y: number }> = {};
    const map = byIdRef.current;
    const sizes = focus ? LAYER_SIZES_FOCUSED : LAYER_SIZES_OVERVIEW;
    const rings: Record<string, string[]> = {};
    for (const b of bubblesRef.current) {
      if (b.parentId) (rings[b.parentId] ??= []).push(b.id);
    }
    for (const b of bubblesRef.current) {
      if (relativeLayer(b.id, focus, map) !== 2) continue;
      const parent = b.parentId ? map[b.parentId] : null;
      if (!parent) continue;
      const gp = parent.parentId ? map[parent.parentId] : null;
      const ring = rings[parent.id] ?? [b.id];
      out[b.id] = pipDisplayPosition(
        parent.x, parent.y,
        sizes[Math.max(0, Math.min(2, relativeLayer(parent.id, focus, map)))] * bubbleScale(parent),
        sizes[2],
        Math.max(0, ring.indexOf(b.id)), ring.length,
        gp ? { x: gp.x, y: gp.y } : null,
      );
    }
    return out;
  }, []);

  // World-space position each bubble is currently DRAWN at, when it differs
  // from its stored position. Empty means "draw everything where it is".
  const displayPos = useRef<Record<string, { x: number; y: number }>>({});
  const displayRaf = useRef<number>(0);

  useEffect(() => {
    cancelAnimationFrame(displayRaf.current);
    const targets = pipTargets(focusedId);
    // Anything not a pip in the new view eases back to its real position.
    const from = { ...displayPos.current };
    const startedAt = Date.now();

    const step = () => {
      const elapsed = Date.now() - startedAt;
      const t = Math.min(1, elapsed / PIP_EASE_MS);
      // easeOutCubic — quick to leave, gentle to arrive.
      const e = 1 - Math.pow(1 - t, 3);
      const next: Record<string, { x: number; y: number }> = {};
      const live = bubblesRef.current;
      for (const b of live) {
        const target = targets[b.id] ?? { x: b.x, y: b.y };
        const start  = from[b.id] ?? { x: b.x, y: b.y };
        if (t >= 1) {
          if (targets[b.id]) next[b.id] = target;   // pips hold their cluster spot
          continue;
        }
        next[b.id] = {
          x: start.x + (target.x - start.x) * e,
          y: start.y + (target.y - start.y) * e,
        };
      }
      displayPos.current = next;
      forcePhysicsTick();
      if (t < 1) displayRaf.current = requestAnimationFrame(step);
    };
    displayRaf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(displayRaf.current);
  }, [focusedId, bubbles, pipTargets]);

  useEffect(() => () => cancelAnimationFrame(displayRaf.current), []);

  // ── Camera fit on focus change ───────────────────────────────────────────────
  // Rule: zoom in only on the FIRST tap (overview → focused).
  // Subsequent taps while already focused just pan at the locked scale so
  // bubbles never stack. Going back to overview zooms out again.
  const prevFocusedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const prevFid = prevFocusedIdRef.current;
    const fid     = focusedId;
    prevFocusedIdRef.current = fid;

    const all     = bubblesRef.current;
    const bid     = byIdRef.current;
    const visible = all.filter(b => isInThreeLayerView(b, fid, bid));
    if (!visible.length) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    visible.forEach(b => {
      const r = getBubbleDisplaySize(b, fid, bid) / 2;
      minX = Math.min(minX, b.x - r); maxX = Math.max(maxX, b.x + r);
      minY = Math.min(minY, b.y - r); maxY = Math.max(maxY, b.y + r);
    });

    if (!fid) {
      // Returning to overview — zoom back out
      animateCamera(fitBounds(dims.width, dims.height, minX, maxX, minY, maxY, 90, 0.9));
    } else if (prevFid === null) {
      // First focus from overview — zoom in once
      animateCamera(fitBounds(dims.width, dims.height, minX, maxX, minY, maxY, 110, 1.6));
    } else {
      // Already focused — pan only, preserve the locked scale. This also
      // covers a resize/rotation while staying focused (prevFid === fid in
      // that case): recenter for the new dimensions without forcing a rezoom.
      const scale = cameraRef.current.scale;
      const midX  = (minX + maxX) / 2;
      const midY  = (minY + maxY) / 2;
      animateCamera({
        x: dims.width / 2 - midX * scale,
        y: dims.height / 2 - midY * scale,
        scale,
      });
    }
  // dims is intentionally a dependency (not just focusedId): a resize or
  // rotation must re-run this to reframe the camera for the new viewport,
  // which is the actual fix for M11 — see the comment on dimsRef above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, dims.width, dims.height]);

  // ── Drag state ───────────────────────────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingIdRef     = useRef<string | null>(null);
  const dragWX            = useRef(0);
  const dragWY            = useRef(0);
  const dragBubbleRef     = useRef<BubbleData | null>(null);
  const dragScreenX       = useRef(new Animated.Value(0)).current;
  const dragScreenY       = useRef(new Animated.Value(0)).current;

  // Animated.ValueXY used to translate the subtree during drag without
  // triggering React re-renders on every frame.
  const subtreeDeltaAnim  = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // ── Long-press state ─────────────────────────────────────────────────────────
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [longPressId, setLongPressId] = useState<string | null>(null);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // ── Gesture state ─────────────────────────────────────────────────────────────
  const touchStart       = useRef({ x: 0, y: 0, time: 0 });
  const cameraTouchStart = useRef({ x: 0, y: 0, scale: INIT_SCALE });
  const pinchStart       = useRef<{ savedScale: number; dist: number; x: number; y: number } | null>(null);
  const bubbleDragStart  = useRef({ wx: 0, wy: 0 });
  const isDraggingBubble = useRef(false);

  // Hit test — reads physicsPos so tap targets match animated positions.
  function hitTest(sx: number, sy: number): string | null {
    const cam   = cameraRef.current;
    const { wx, wy } = toWorld(sx, sy, cam);
    const vis   = visibleRef.current;
    const fid   = focusedIdRef.current;
    const bid   = byIdRef.current;
    const physP = physicsPos.current;
    for (let i = vis.length - 1; i >= 0; i--) {
      const b = vis[i];
      // Layer-2 pips are rendered pointerEvents="none" (bare presence dots,
      // no label, no chrome) — but that only blocks BubbleNode's own touch
      // area, not this geometric hit test, so a pip was still tappable and
      // would focus into it. Web deliberately makes layer 2 visual-only;
      // exclude it here too so both platforms treat it the same way.
      if (relativeLayer(b.id, fid, bid) === 2) continue;
      // Same precedence as the renderer, so a bubble is tappable exactly where
      // it is drawn — including mid-flight while the pip cluster eases out.
      const phys = physP[b.id];
      const disp = displayPos.current[b.id];
      const bx   = phys ? phys.x : disp ? disp.x : b.x;
      const by   = phys ? phys.y : disp ? disp.y : b.y;
      const size = getBubbleDisplaySize(b, fid, bid);
      const r    = size / 2;
      const dx   = wx - bx, dy = wy - by;
      if (dx * dx + dy * dy <= r * r) return b.id;
    }
    return null;
  }

  // ── Derived: subtree during drag ─────────────────────────────────────────────
  // Only recompute when draggingId changes (not on every bubble position update).
  const draggingSubtreeSet = useMemo<Set<string>>(() => {
    if (!draggingId) return new Set();
    return new Set(getAllDescendants(draggingId, bubblesRef.current));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingId]);

  // ── PanResponder ──────────────────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,

      onPanResponderGrant(evt) {
        // Any touch on the canvas counts as "actively working", so the 30s
        // check will not swap the map out from under a gesture in progress.
        noteInteraction();
        cancelAnimationFrame(animFrameRef.current);
        clearLongPress();

        const touches = evt.nativeEvent.touches;
        const t0 = touches[0];
        touchStart.current       = { x: t0.pageX, y: t0.pageY, time: Date.now() };
        cameraTouchStart.current = { ...cameraRef.current };
        pinchStart.current       = null;
        isDraggingBubble.current = false;
        subtreeDeltaAnim.setValue({ x: 0, y: 0 });

        if (touches.length >= 2) {
          draggingIdRef.current = null;
          const t1 = touches[1];
          const dx = t1.pageX - t0.pageX, dy = t1.pageY - t0.pageY;
          pinchStart.current = {
            savedScale: cameraRef.current.scale,
            dist: Math.sqrt(dx * dx + dy * dy),
            x: (t0.pageX + t1.pageX) / 2,
            y: (t0.pageY + t1.pageY) / 2,
          };
          return;
        }

        const hit = hitTest(t0.pageX, t0.pageY);
        draggingIdRef.current = hit;

        // Cancel physics and commit partial sibling displacements (excluding the
        // dragged bubble) BEFORE deriving drag coordinates — prevents the
        // [bubbles] cleanup from overwriting the dropped position.
        cancelAnimationFrame(physicsRaf.current);
        const oldPhysics = physicsPos.current;
        physicsPos.current = {};
        if (Object.keys(oldPhysics).length > 0) {
          const cur = bubblesRef.current;
          const updates: { id: string; x: number; y: number }[] = [];
          for (const b of cur) {
            if (b.id === hit) continue;
            const np = oldPhysics[b.id];
            if (np && (Math.abs(np.x - b.x) > 0.5 || Math.abs(np.y - b.y) > 0.5)) {
              updates.push({ id: b.id, x: np.x, y: np.y });
            }
          }
          if (updates.length) batchUpdateRef.current(updates);
        }

        if (hit) {
          const b = byIdRef.current[hit];
          if (b) {
            // Use physics position as drag origin so the bubble doesn't jump.
            const physHit = oldPhysics[hit];
            const startX  = physHit ? physHit.x : b.x;
            const startY  = physHit ? physHit.y : b.y;
            bubbleDragStart.current = { wx: startX, wy: startY };
            dragWX.current = startX;
            dragWY.current = startY;
          }

          // Long-press fires after LONG_PRESS_MS without movement
          if (!editModeRef.current) {
            longPressTimerRef.current = setTimeout(() => {
              longPressTimerRef.current = null;
              isDraggingBubble.current  = false;
              draggingIdRef.current     = null;
              setLongPressId(null);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              onLongPressRef.current?.(hit);
            }, LONG_PRESS_MS);
          }
        }
      },

      onPanResponderMove(evt) {
        const touches = evt.nativeEvent.touches;

        // ── Pinch zoom ──────────────────────────────────────────────────────
        if (touches.length >= 2) {
          clearLongPress();
          const t0 = touches[0], t1 = touches[1];
          const dx = t1.pageX - t0.pageX, dy = t1.pageY - t0.pageY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const midX = (t0.pageX + t1.pageX) / 2;
          const midY = (t0.pageY + t1.pageY) / 2;

          if (!pinchStart.current) {
            pinchStart.current = {
              savedScale: cameraRef.current.scale,
              dist, x: midX, y: midY,
            };
            return;
          }

          // Both distances must be positive before dividing. Two touches can
          // report the same pageX/pageY for a frame at the start of a pinch,
          // which makes this 0/0 = NaN — and NaN survives the clamp below
          // (Math.max(MIN, Math.min(MAX, NaN)) is NaN), permanently poisoning
          // the camera. Web has always had this guard (MindCanvas.tsx); mobile
          // did not, which is what made the app error out and need a hard
          // refresh. Skipping the frame is harmless: the next move event with
          // real separation resumes the pinch normally.
          if (pinchStart.current.dist <= 0 || dist <= 0) {
            pinchStart.current.dist = dist;
            return;
          }

          const ratio = dist / pinchStart.current.dist;
          const newS  = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStart.current.savedScale * ratio));
          const { wx: focWX, wy: focWY } = toWorld(midX, midY, cameraRef.current);
          const newCam: Camera = {
            x: midX - focWX * newS,
            y: midY - focWY * newS,
            scale: newS,
          };
          // Incremental update: each frame is relative to current state
          pinchStart.current.dist = dist;
          pinchStart.current.savedScale = newS;
          applyCameraImmediate(newCam);
          return;
        }

        const t0   = touches[0];
        const dx   = t0.pageX - touchStart.current.x;
        const dy   = t0.pageY - touchStart.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Cancel long-press if moved significantly
        if (dist > DRAG_THRESH && longPressTimerRef.current) {
          clearLongPress();
          setLongPressId(null);
        }

        // ── Bubble drag ──────────────────────────────────────────────────────
        if (dist > DRAG_THRESH && draggingIdRef.current) {
          if (!isDraggingBubble.current) {
            isDraggingBubble.current = true;
            const b = byIdRef.current[draggingIdRef.current];
            dragBubbleRef.current = b ?? null;
            setDraggingId(draggingIdRef.current);
          }
        }

        if (draggingIdRef.current && isDraggingBubble.current) {
          const s    = cameraRef.current.scale;
          let newWX  = bubbleDragStart.current.wx + dx / s;
          let newWY  = bubbleDragStart.current.wy + dy / s;

          // Constrain to the ring around parent so the bubble can only orbit,
          // not drift away or collapse onto, its parent.
          const b = dragBubbleRef.current;
          if (b?.parentId) {
            const c = constrainToParentRing(
              newWX, newWY, b, byIdRef.current, bubblesRef.current, focusedIdRef.current,
            );
            newWX = c.x;
            newWY = c.y;
          }

          dragWX.current = newWX;
          dragWY.current = newWY;

          // Move the drag-overlay bubble
          const fid = focusedIdRef.current;
          const bid = byIdRef.current;
          if (b) {
            const size = getBubbleDisplaySize(b, fid, bid) * cameraRef.current.scale;
            const { sx, sy } = toScreen(newWX, newWY, cameraRef.current);
            dragScreenX.setValue(sx - size / 2);
            dragScreenY.setValue(sy - size / 2);
          }

          // Translate subtree by the actual constrained screen-space delta
          // (not raw touch delta) so children move exactly with their parent.
          const actualDx = (newWX - bubbleDragStart.current.wx) * s;
          const actualDy = (newWY - bubbleDragStart.current.wy) * s;
          subtreeDeltaAnim.setValue({ x: actualDx, y: actualDy });
          return;
        }

        // ── Camera pan ───────────────────────────────────────────────────────
        if (!draggingIdRef.current) {
          applyCameraImmediate({
            x:     cameraTouchStart.current.x + dx,
            y:     cameraTouchStart.current.y + dy,
            scale: cameraTouchStart.current.scale,
          });
        }
      },

      onPanResponderRelease(evt) {
        clearLongPress();
        setLongPressId(null);

        const t0   = evt.nativeEvent.changedTouches[0];
        const dx   = t0.pageX - touchStart.current.x;
        const dy   = t0.pageY - touchStart.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const dur  = Date.now() - touchStart.current.time;

        if (isDraggingBubble.current && draggingIdRef.current) {
          const draggedId  = draggingIdRef.current;
          const s          = cameraRef.current.scale;
          const allBubbles = bubblesRef.current;
          const bid        = byIdRef.current;

          // Apply ring constraint to final drop position
          let newX = bubbleDragStart.current.wx + dx / s;
          let newY = bubbleDragStart.current.wy + dy / s;
          const draggedB = bid[draggedId];
          if (draggedB?.parentId) {
            const c = constrainToParentRing(
              newX, newY, draggedB, bid, allBubbles, focusedIdRef.current,
            );
            newX = c.x;
            newY = c.y;
          }

          // Actual world-space delta after constraint
          const actualDeltaX = newX - bubbleDragStart.current.wx;
          const actualDeltaY = newY - bubbleDragStart.current.wy;

          // Build complete new positions: dragged bubble + all descendants
          const descIds = getAllDescendants(draggedId, allBubbles);
          const updates: { id: string; x: number; y: number }[] = [
            { id: draggedId, x: newX, y: newY },
            ...descIds.map(descId => {
              const desc = bid[descId];
              return desc
                ? { id: descId, x: desc.x + actualDeltaX, y: desc.y + actualDeltaY }
                : null;
            }).filter(Boolean) as { id: string; x: number; y: number }[],
          ];

          // Apply updates to a local snapshot and run collision resolution
          const posMap = new Map(updates.map(u => [u.id, u]));
          const tempBubbles = allBubbles.map(b => {
            const u = posMap.get(b.id);
            return u ? { ...b, x: u.x, y: u.y } : b;
          });
          const resolved = resolveCollisions(
            tempBubbles, focusedIdRef.current, byIdRef.current, null, 4,
          );

          // Merge resolved positions into updates
          const allUpdates = new Map<string, { id: string; x: number; y: number; angle?: number; radial?: number }>(
            updates.map(u => [u.id, u]),
          );
          for (const [id, pos] of Object.entries(resolved)) {
            allUpdates.set(id, { id, ...pos });
          }

          // H3: derive angle/radial for every non-root bubble whose x/y just
          // changed here, so the drop is representable and syncable on the
          // other platform — web stores a child's position as angle + a
          // leash fraction, not x/y. This naturally covers descendants and
          // collision-pushed siblings correctly, not just the dragged bubble
          // itself: a descendant's relative offset from ITS OWN parent was
          // preserved exactly by the uniform delta above (or is unaffected
          // if only a sibling moved), so deriving from the (possibly also
          // updated) parent position here reproduces the same angle/radial
          // it already implicitly had — this is a correctness pass, not a
          // behavior change, for anything that didn't have angle/radial set.
          const finalUpdates = [...allUpdates.values()].map(u => {
            const b = bid[u.id];
            if (!b?.parentId) return u;
            const parent = bid[b.parentId];
            if (!parent) return u;
            const parentPos = allUpdates.get(parent.id) ?? { x: parent.x, y: parent.y };
            // MUST match canonicalBand in bubbleLayout.ts exactly — this is the
            // inverse conversion. If the two disagree, a drag writes an
            // angle/radial that resolves somewhere else and the bubble jumps
            // the moment positions are re-derived. Hence getSize (scale-aware)
            // and the largest-sibling term, both mirroring canonicalBand.
            const ringSiblings = allBubbles.filter(s => s.parentId === b.parentId);
            const siblingCount = Math.max(1, ringSiblings.length);
            const maxSiblingR = Math.max(getSize(b) / 2, ...ringSiblings.map(s => getSize(s) / 2));
            const band = radialBand(getSize(parent) / 2, getSize(b) / 2, siblingCount, maxSiblingR);
            const { angle, radial } = deriveAngleRadial(u.x, u.y, parentPos.x, parentPos.y, band);
            return { ...u, angle, radial };
          });

          batchUpdateRef.current(finalUpdates);
          // The dragged bubble has a new position on its ring, so every
          // descendant's canonical x/y — derived from its own angle/radial
          // relative to its parent — has to be recomputed. (The old name for
          // this, snapGrandchildren, described a long-dead grandchild-only
          // fixed-fan pass; it walks the whole tree.)
          resyncPositionsRef.current();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

          // Resetting subtreeDeltaAnim to zero HERE (synchronously, before the
          // batchUpdate above has been committed and re-rendered) used to
          // cause a one-frame snap-back: subtreeBubbles render from stored
          // b.x/b.y, offset by this Animated.Value, so zeroing it before the
          // new x/y have propagated briefly shows the subtree at its OLD
          // (pre-drag) position. Deferring one frame lets the state update
          // commit first, so by the time the offset is zeroed the bubbles are
          // already rendering at the new position and there's nothing to jump.
          requestAnimationFrame(() => subtreeDeltaAnim.setValue({ x: 0, y: 0 }));

        } else if (dist < TAP_DIST && dur < TAP_MS && !pinchStart.current) {
          // Only the most recent tap's deferred single-tap action should ever
          // fire — an in-flight timer from an earlier, different tap (on
          // another bubble, or before a tap on the background) is stale now.
          if (singleTapTimerRef.current) {
            clearTimeout(singleTapTimerRef.current);
            singleTapTimerRef.current = null;
          }

          if (draggingIdRef.current) {
            const tappedId = draggingIdRef.current;
            const now      = Date.now();
            const last     = lastTapRef.current;
            if (last.id === tappedId && now - last.time < DOUBLE_TAP_MS) {
              // Double-tap detected — reset so a third tap starts fresh.
              lastTapRef.current = { id: null, time: 0 };
              handleBubbleDoubleTap(tappedId);
            } else {
              lastTapRef.current = { id: tappedId, time: now };
              // Defer instead of firing immediately: if a second tap on this
              // same bubble lands within DOUBLE_TAP_MS, the branch above
              // fires the double-tap action and this timer gets cancelled by
              // that tap's own cleanup at the top of this block — otherwise
              // it fires as a genuine single tap once the window passes.
              singleTapTimerRef.current = setTimeout(() => {
                singleTapTimerRef.current = null;
                handleBubbleTap(tappedId);
              }, DOUBLE_TAP_MS);
            }
          } else {
            lastTapRef.current = { id: null, time: 0 };
            handleBackgroundTap();
          }
        }

        draggingIdRef.current    = null;
        dragBubbleRef.current    = null;
        isDraggingBubble.current = false;
        setDraggingId(null);
        pinchStart.current = null;
      },

      onPanResponderTerminate() {
        clearLongPress();
        setLongPressId(null);
        subtreeDeltaAnim.setValue({ x: 0, y: 0 });
        draggingIdRef.current    = null;
        dragBubbleRef.current    = null;
        isDraggingBubble.current = false;
        setDraggingId(null);
        pinchStart.current = null;
      },
    }),
  ).current;

  function handleBubbleDoubleTap(id: string) {
    Haptics.selectionAsync();
    onDoubleTapRef.current?.(id);
  }

  function handleBubbleTap(id: string) {
    const em  = editModeRef.current;
    const fid = focusedIdRef.current;
    const bid = byIdRef.current;
    const b   = bid[id];

    if (em) {
      setEditSelRef.current(editSelRef.current === id ? null : id);
      Haptics.selectionAsync();
      return;
    }
    if (id === fid) {
      const parent = b?.parentId ? bid[b.parentId] : null;
      setFocusedRef.current(parent?.id ?? null);
      return;
    }
    setFocusedRef.current(id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  function handleBackgroundTap() {
    const em  = editModeRef.current;
    const fid = focusedIdRef.current;
    if (em) { setEditSelRef.current(null); return; }
    if (fid) {
      const b = byIdRef.current[fid];
      setFocusedRef.current(b?.parentId ?? null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const cam = camera;
  const dragBubble = draggingId ? byId[draggingId] : null;

  // Split visible bubbles into static (not in drag subtree) and moving (in subtree).
  const staticBubbles  = useMemo(
    () => visibleBubbles.filter(b => b.id !== draggingId && !draggingSubtreeSet.has(b.id)),
    [visibleBubbles, draggingId, draggingSubtreeSet],
  );
  const subtreeBubbles = useMemo(
    () => visibleBubbles.filter(b => draggingSubtreeSet.has(b.id)),
    [visibleBubbles, draggingSubtreeSet],
  );

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      {/* SVG coordinate field background */}
      <CanvasBackground camera={cam} />

      {/* ── Static bubbles ──────────────────────────────────────────────── */}
      {staticBubbles.map(b => {
        const worldDisplaySize = getBubbleDisplaySize(b, focusedId, byId);
        const size  = worldDisplaySize * cam.scale;
        const layer = relativeLayer(b.id, focusedId, byId);
        // Use physics working position during animation; fall back to stored.
        // Draw order of precedence: an active drag/settle position, then the
        // eased display position (which is where a layer-2 pip lives), then
        // the bubble's real stored position.
        const phys  = physicsPos.current[b.id];
        const disp  = displayPos.current[b.id];
        const wx    = phys ? phys.x : disp ? disp.x : b.x;
        const wy    = phys ? phys.y : disp ? disp.y : b.y;
        const { sx, sy } = toScreen(wx, wy, cam);
        return (
          <BubbleNode
            key={b.id}
            bubble={b}
            size={size}
            screenX={sx}
            screenY={sy}
            isFocused={b.id === focusedId}
            isSelected={editMode && editSelection === b.id}
            isGrandchild={layer === 2}
            worldDisplaySize={worldDisplaySize}
            labelReveal={labelReveal}
            ghosted={showArchived && b.archivedAt !== undefined}
            completing={completingId === b.id}
          />
        );
      })}

      {/* ── Subtree bubbles — translated natively with Animated ─────────── */}
      {subtreeBubbles.length > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { transform: subtreeDeltaAnim.getTranslateTransform() },
          ]}
        >
          {subtreeBubbles.map(b => {
            const worldDisplaySize = getBubbleDisplaySize(b, focusedId, byId);
            const size  = worldDisplaySize * cam.scale;
            const layer = relativeLayer(b.id, focusedId, byId);
            const { sx, sy } = toScreen(b.x, b.y, cam);
            return (
              <BubbleNode
                key={b.id}
                bubble={b}
                size={size}
                screenX={sx}
                screenY={sy}
                isFocused={false}
                isSelected={false}
                isGrandchild={layer === 2}
                worldDisplaySize={worldDisplaySize}
                labelReveal={labelReveal}
                ghosted={showArchived && b.archivedAt !== undefined}
                completing={completingId === b.id}
              />
            );
          })}
        </Animated.View>
      )}

      {/* ── Dragged bubble overlay ───────────────────────────────────────── */}
      {dragBubble && (() => {
        const worldDisplaySize = getBubbleDisplaySize(dragBubble, focusedId, byId);
        const size = worldDisplaySize * cam.scale;
        return (
          <Animated.View
            style={[styles.dragBubble, {
              left:   dragScreenX as unknown as number,
              top:    dragScreenY as unknown as number,
              width:  size,
              height: size,
            }]}
          >
            <BubbleNode
              bubble={dragBubble}
              size={size}
              screenX={size / 2}
              screenY={size / 2}
              isFocused={false}
              isSelected={false}
              isGrandchild={false}
              worldDisplaySize={worldDisplaySize}
              labelReveal={labelReveal}
            />
          </Animated.View>
        );
      })()}

      {/* ── Long-press pulse ring ─────────────────────────────────────────── */}
      {longPressId && (() => {
        const b = byId[longPressId];
        if (!b) return null;
        const worldDisplaySize = getBubbleDisplaySize(b, focusedId, byId);
        const size = worldDisplaySize * cam.scale;
        const { sx, sy } = toScreen(b.x, b.y, cam);
        const r = size / 2;
        return (
          <View
            pointerEvents="none"
            style={[styles.longPressRing, {
              left:   sx - r - 6,
              top:    sy - r - 6,
              width:  size + 12,
              height: size + 12,
              borderRadius: r + 6,
            }]}
          />
        );
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  dragBubble: {
    position: 'absolute',
    zIndex: 200,
  },
  longPressRing: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.75)',
    zIndex: 150,
  },
});

const PHYS_SPRING = 0.4;   // fraction of overlap to resolve per frame (spring feel)

const PHYS_MAX_FRAMES = 90; // ~1.5 s safety timeout

const PHYS_SETTLE = 0.3;   // max displacement (world units) before settling

function resolveCollisionsStep(
  bubbles: BubbleData[],
  pos: Record<string, { x: number; y: number }>,
  byId: Record<string, BubbleData>,
  focusedId: string | null,
  immovableId: string | null,
  iterations = 4,
): number {
  let maxDisp = 0;
  const n = bubbles.length;

  // Pre-compute display radii once per frame — they are the visual radii the
  // user sees, so overlap must be resolved in that same coordinate system.
  const radii: Record<string, number> = {};
  for (const b of bubbles) {
    radii[b.id] = getBubbleDisplaySize(b, focusedId, byId) / 2;
  }

  for (let iter = 0; iter < iterations; iter++) {
    // — pairwise separation (only same-parent siblings collide) —
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = bubbles[i], b = bubbles[j];
        // Only collide same-parent siblings. Roots (no parentId) are excluded:
        // `undefined === undefined` would incorrectly treat them as siblings.
        if (!a.parentId || a.parentId !== b.parentId) continue;
        const pa = pos[a.id], pb = pos[b.id];
        if (!pa || !pb) continue;

        const ra = radii[a.id], rb = radii[b.id];
        const minSep = ra + rb + PHYS_GAP;

        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        let d  = Math.hypot(dx, dy);
        if (d === 0) { dx = 0.7071; dy = 0.7071; d = 1; }
        if (d >= minSep) continue;

        const push = (minSep - d) * PHYS_SPRING;
        const ux = dx / d, uy = dy / d;

        const ma = ra * ra, mb = rb * rb;
        const aFixed = a.id === immovableId;
        const bFixed = b.id === immovableId;
        let wa: number, wb: number;
        if      (aFixed && bFixed) { wa = 0;              wb = 0; }
        else if (aFixed)           { wa = 0;              wb = 1; }
        else if (bFixed)           { wa = 1;              wb = 0; }
        else                       { wa = mb / (ma + mb); wb = ma / (ma + mb); }

        const ax = ux * push * wa, ay = uy * push * wa;
        const bx = ux * push * wb, by = uy * push * wb;
        pa.x -= ax; pa.y -= ay;
        pb.x += bx; pb.y += by;
        maxDisp = Math.max(maxDisp, Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by));
      }
    }

    // — parent ring constraint: keep each child inside [minD, maxD] of its parent —
    for (const b of bubbles) {
      if (!b.parentId) continue;
      const parent = byId[b.parentId];
      const pp = pos[b.parentId];
      const pb = pos[b.id];
      if (!parent || !pp || !pb) continue;

      const pr = radii[parent.id] ?? 0;
      const cr = radii[b.id] ?? 0;
      const siblings = bubbles.filter(s => s.parentId === b.parentId);
      const minD = pr + cr + PHYS_GAP;
      const natural = ringRadius(pr, cr, siblings.length);
      const maxD = Math.max(natural + Math.max(40, pr * 0.9), minD + Math.max(48, pr * 1.6));

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

  return maxDisp;
}
