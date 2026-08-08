import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useBubbles } from '@/context/BubbleContext';
import { BubbleNode } from '@/components/BubbleNode';
import { CanvasBackground } from '@/components/CanvasBackground';
import {
  getBubbleDisplaySize, isInThreeLayerView, relativeLayer,
  getAllDescendants, resolveCollisions, ringRadius,
} from '@/lib/bubbleLayout';
import { BubbleData } from '@/lib/bubbleTypes';

const { width: SW, height: SH } = Dimensions.get('window');

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
  minX: number, maxX: number, minY: number, maxY: number,
  pad = 90, maxScale = 0.9,
): Camera {
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const scale = Math.min(SW / w, SH / h, maxScale);
  const midX  = (minX + maxX) / 2;
  const midY  = (minY + maxY) / 2;
  return { x: SW / 2 - midX * scale, y: SH / 2 - midY * scale, scale };
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

const PHYS_GAP = 12;       // min gap between bubble edges, world units

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  /** Called when the user long-presses a bubble to add a child to it. */
  onLongPressAddChild?: (parentId: string) => void;
  /** Called when the user double-taps a bubble to rename it. */
  onDoubleTapBubble?: (id: string) => void;
}

export default function CanvasView({ onLongPressAddChild, onDoubleTapBubble }: Props) {
  const {
    bubbles, focusedId, editMode, editSelection, byId,
    setFocusedId, setEditSelection, updateBubblePosition,
    batchUpdatePositions,
  } = useBubbles();

  // ── Camera ──────────────────────────────────────────────────────────────────
  const cameraRef  = useRef<Camera>({ x: SW / 2, y: SH / 2, scale: INIT_SCALE });
  const [camera, setCamera] = useState<Camera>({ x: SW / 2, y: SH / 2, scale: INIT_SCALE });

  function applyCameraImmediate(cam: Camera) {
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
  const onLongPressRef    = useRef(onLongPressAddChild); onLongPressRef.current    = onLongPressAddChild;
  const onDoubleTapRef    = useRef(onDoubleTapBubble);  onDoubleTapRef.current    = onDoubleTapBubble;

  // Tracks the last bubble tap for double-tap detection.
  const lastTapRef = useRef<{ id: string | null; time: number }>({ id: null, time: 0 });

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
      animateCamera(fitBounds(minX, maxX, minY, maxY, 90, 0.9));
    } else if (prevFid === null) {
      // First focus from overview — zoom in once
      animateCamera(fitBounds(minX, maxX, minY, maxY, 110, 1.6));
    } else {
      // Already focused — pan only, preserve the locked scale
      const scale = cameraRef.current.scale;
      const midX  = (minX + maxX) / 2;
      const midY  = (minY + maxY) / 2;
      animateCamera({
        x: SW / 2 - midX * scale,
        y: SH / 2 - midY * scale,
        scale,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId]);

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
      const b    = vis[i];
      const phys = physP[b.id];
      const bx   = phys ? phys.x : b.x;
      const by   = phys ? phys.y : b.y;
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
          const s     = cameraRef.current.scale;
          const newWX = bubbleDragStart.current.wx + dx / s;
          const newWY = bubbleDragStart.current.wy + dy / s;
          dragWX.current = newWX;
          dragWY.current = newWY;

          // Move the drag-overlay bubble
          const fid  = focusedIdRef.current;
          const bid  = byIdRef.current;
          const b    = dragBubbleRef.current;
          if (b) {
            const size = getBubbleDisplaySize(b, fid, bid) * cameraRef.current.scale;
            const { sx, sy } = toScreen(newWX, newWY, cameraRef.current);
            dragScreenX.setValue(sx - size / 2);
            dragScreenY.setValue(sy - size / 2);
          }

          // Translate the entire subtree natively (no JS re-render per frame)
          subtreeDeltaAnim.setValue({ x: dx, y: dy });
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

        // Reset subtree animation value (positions will be committed to state)
        subtreeDeltaAnim.setValue({ x: 0, y: 0 });

        if (isDraggingBubble.current && draggingIdRef.current) {
          const draggedId = draggingIdRef.current;
          const s         = cameraRef.current.scale;
          const deltaX    = dx / s;
          const deltaY    = dy / s;
          const newX      = bubbleDragStart.current.wx + deltaX;
          const newY      = bubbleDragStart.current.wy + deltaY;

          // Build complete new positions: dragged bubble + all descendants
          const allBubbles  = bubblesRef.current;
          const descIds     = getAllDescendants(draggedId, allBubbles);
          const bid         = byIdRef.current;

          const updates: { id: string; x: number; y: number }[] = [
            { id: draggedId, x: newX, y: newY },
            ...descIds.map(descId => {
              const desc = bid[descId];
              return desc
                ? { id: descId, x: desc.x + deltaX, y: desc.y + deltaY }
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
          const allUpdates = new Map(updates.map(u => [u.id, u]));
          for (const [id, pos] of Object.entries(resolved)) {
            allUpdates.set(id, { id, ...pos });
          }

          batchUpdateRef.current([...allUpdates.values()]);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        } else if (dist < TAP_DIST && dur < TAP_MS && !pinchStart.current) {
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
              handleBubbleTap(tappedId);
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
        const phys  = physicsPos.current[b.id];
        const wx    = phys ? phys.x : b.x;
        const wy    = phys ? phys.y : b.y;
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
