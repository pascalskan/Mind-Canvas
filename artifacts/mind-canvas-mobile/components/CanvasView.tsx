import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useBubbles } from '@/context/BubbleContext';
import { BubbleNode } from '@/components/BubbleNode';
import { CanvasBackground } from '@/components/CanvasBackground';
import {
  getBubbleDisplaySize, isInThreeLayerView, relativeLayer,
  getAllDescendants, resolveCollisions,
} from '@/lib/bubbleLayout';
import { BubbleData } from '@/lib/bubbleTypes';

const { width: SW, height: SH } = Dimensions.get('window');

const INIT_SCALE   = 0.28;
const MIN_SCALE    = 0.06;
const MAX_SCALE    = 5.0;
const TAP_DIST     = 10;
const TAP_MS       = 280;
const DRAG_THRESH  = 6;
const LONG_PRESS_MS = 500;

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

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  /** Called when the user long-presses a bubble to add a child to it. */
  onLongPressAddChild?: (parentId: string) => void;
}

export default function CanvasView({ onLongPressAddChild }: Props) {
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
  const onLongPressRef = useRef(onLongPressAddChild); onLongPressRef.current = onLongPressAddChild;

  // ── Visible bubbles ──────────────────────────────────────────────────────────
  const visibleBubbles = useMemo(
    () => bubbles.filter(b => isInThreeLayerView(b, focusedId, byId)),
    [bubbles, focusedId, byId],
  );
  const visibleRef = useRef(visibleBubbles); visibleRef.current = visibleBubbles;

  // ── Camera fit on focus change ───────────────────────────────────────────────
  useEffect(() => {
    const fid = focusedId;
    const all = bubblesRef.current;
    const bid = byIdRef.current;
    const visible = all.filter(b => isInThreeLayerView(b, fid, bid));
    if (!visible.length) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    visible.forEach(b => {
      const r = getBubbleDisplaySize(b, fid, bid) / 2;
      minX = Math.min(minX, b.x - r); maxX = Math.max(maxX, b.x + r);
      minY = Math.min(minY, b.y - r); maxY = Math.max(maxY, b.y + r);
    });

    animateCamera(
      fid
        ? fitBounds(minX, maxX, minY, maxY, 110, 1.6)   // focused
        : fitBounds(minX, maxX, minY, maxY, 90,  0.9),  // overview
    );
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

  // Hit test
  function hitTest(sx: number, sy: number): string | null {
    const cam = cameraRef.current;
    const { wx, wy } = toWorld(sx, sy, cam);
    const vis = visibleRef.current;
    const fid = focusedIdRef.current;
    const bid = byIdRef.current;
    for (let i = vis.length - 1; i >= 0; i--) {
      const b    = vis[i];
      const size = getBubbleDisplaySize(b, fid, bid);
      const r    = size / 2;
      const dx   = wx - b.x, dy = wy - b.y;
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

        if (hit) {
          const b = byIdRef.current[hit];
          if (b) {
            bubbleDragStart.current = { wx: b.x, wy: b.y };
            dragWX.current = b.x;
            dragWY.current = b.y;
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
            handleBubbleTap(draggingIdRef.current);
          } else {
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

      {/* ── Connection lines (parent → child) — behind bubbles ─────────── */}
      <Svg
        width={SW} height={SH}
        style={styles.connectorLayer}
        pointerEvents="none"
      >
        {visibleBubbles.map(b => {
          if (!b.parentId) return null;
          const parent = byId[b.parentId];
          if (!parent || !isInThreeLayerView(parent, focusedId, byId)) return null;

          // Dragged bubble: use current drag world position for its line endpoint
          const bx = b.id === draggingId
            ? dragWX.current
            : draggingSubtreeSet.has(b.id)
              ? b.x + (dragWX.current - bubbleDragStart.current.wx)
              : b.x;
          const by_ = b.id === draggingId
            ? dragWY.current
            : draggingSubtreeSet.has(b.id)
              ? b.y + (dragWY.current - bubbleDragStart.current.wy)
              : b.y;

          const px_ = parent.id === draggingId
            ? dragWX.current
            : draggingSubtreeSet.has(parent.id)
              ? parent.x + (dragWX.current - bubbleDragStart.current.wx)
              : parent.x;
          const py_ = parent.id === draggingId
            ? dragWY.current
            : draggingSubtreeSet.has(parent.id)
              ? parent.y + (dragWY.current - bubbleDragStart.current.wy)
              : parent.y;

          const { sx: x1, sy: y1 } = toScreen(px_, py_, cam);
          const { sx: x2, sy: y2 } = toScreen(bx, by_, cam);

          return (
            <Line
              key={b.id}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={b.color}
              strokeWidth={1.5}
              opacity={0.35}
            />
          );
        })}
      </Svg>

      {/* ── Static bubbles ──────────────────────────────────────────────── */}
      {staticBubbles.map(b => {
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
  connectorLayer: {
    position: 'absolute',
    top: 0, left: 0,
    zIndex: 1,
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
