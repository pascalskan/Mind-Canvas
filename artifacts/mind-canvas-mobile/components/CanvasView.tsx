import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useBubbles } from '@/context/BubbleContext';
import { BubbleNode } from '@/components/BubbleNode';
import {
  getBubbleDisplaySize, isInThreeLayerView, relativeLayer,
  LAYER_SIZES_OVERVIEW, LAYER_SIZES_FOCUSED,
} from '@/lib/bubbleLayout';
import { BubbleData } from '@/lib/bubbleTypes';

const { width: SW, height: SH } = Dimensions.get('window');

const INIT_SCALE  = 0.28;
const MIN_SCALE   = 0.06;
const MAX_SCALE   = 5.0;
const TAP_DIST    = 10;
const TAP_MS      = 280;
const DRAG_THRESH = 6;

interface Camera { x: number; y: number; scale: number }

// World → Screen:  screenX = worldX * s + camX
function toScreen(wx: number, wy: number, cam: Camera) {
  return { sx: wx * cam.scale + cam.x, sy: wy * cam.scale + cam.y };
}
// Screen → World
function toWorld(sx: number, sy: number, cam: Camera) {
  return { wx: (sx - cam.x) / cam.scale, wy: (sy - cam.y) / cam.scale };
}

function fitBounds(
  minX: number, maxX: number, minY: number, maxY: number,
  pad = 80, maxScale = 1.4,
): Camera {
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const scale = Math.min(SW / w, SH / h, maxScale);
  const midX  = (minX + maxX) / 2;
  const midY  = (minY + maxY) / 2;
  return { x: SW / 2 - midX * scale, y: SH / 2 - midY * scale, scale };
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

export default function CanvasView() {
  const {
    bubbles, focusedId, editMode, editSelection,
    setFocusedId, setEditSelection, updateBubblePosition, byId,
  } = useBubbles();

  // ── Camera ──────────────────────────────────────────────────────────────────
  // We store camera in a ref (for gesture math) AND in state (to trigger renders).
  const cameraRef = useRef<Camera>({ x: SW / 2, y: SH / 2, scale: INIT_SCALE });
  const [camera,  setCamera]  = useState<Camera>({ x: SW / 2, y: SH / 2, scale: INIT_SCALE });

  // Apply camera instantly (e.g. during gesture)
  function applyCameraImmediate(cam: Camera) {
    cameraRef.current = cam;
    setCamera({ ...cam });
  }

  // Animate camera toward target with spring-ish lerp via RAF
  const animFrameRef = useRef<number>(0);
  function animateCamera(target: Camera) {
    cancelAnimationFrame(animFrameRef.current);
    const step = () => {
      const cur = cameraRef.current;
      const t = 0.18;
      const next: Camera = {
        x: lerp(cur.x, target.x, t),
        y: lerp(cur.y, target.y, t),
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
  const setFocusedRef = useRef(setFocusedId); setFocusedRef.current = setFocusedId;
  const setEditSelRef = useRef(setEditSelection); setEditSelRef.current = setEditSelection;

  // ── Derived: visible bubbles ─────────────────────────────────────────────────
  const visibleBubbles = React.useMemo(
    () => bubbles.filter(b => isInThreeLayerView(b, focusedId, byId)),
    [bubbles, focusedId, byId],
  );
  const visibleRef = useRef(visibleBubbles); visibleRef.current = visibleBubbles;

  // ── Camera fit on focus change ───────────────────────────────────────────────
  useEffect(() => {
    const fid = focusedId;
    const all = bubblesRef.current;
    const bid = byIdRef.current;

    if (!fid) {
      const roots = all.filter(b => b.depth === 0);
      if (!roots.length) return;

      // Compute bounding box of root centres (no bubble radius padding yet)
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      roots.forEach(r => {
        minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x);
        minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y);
      });

      // Use a scale that shows everything at ~60 % fill, then push it 1.6× larger
      // so bubbles feel big on-screen. Allow the outer roots to bleed off-edge —
      // the user can pinch/pan to see them. Cap at 0.85 to avoid going crazy.
      const span   = Math.max(maxX - minX, 1);
      const spanY  = Math.max(maxY - minY, 1);
      const fitS   = Math.min(SW / (span + 200), SH / (spanY + 200));
      const overviewScale = Math.min(fitS * 1.6, 0.85);

      const centX = (minX + maxX) / 2;
      const centY = (minY + maxY) / 2;
      animateCamera({
        x:     SW / 2 - centX * overviewScale,
        y:     SH / 2 - centY * overviewScale,
        scale: overviewScale,
      });
      return;
    }

    const focused  = bid[fid];
    if (!focused) return;
    const children = all.filter(b => b.parentId === fid);

    let minX = focused.x - LAYER_SIZES_FOCUSED[0] / 2;
    let maxX = focused.x + LAYER_SIZES_FOCUSED[0] / 2;
    let minY = focused.y - LAYER_SIZES_FOCUSED[0] / 2;
    let maxY = focused.y + LAYER_SIZES_FOCUSED[0] / 2;
    children.forEach(c => {
      const s = LAYER_SIZES_FOCUSED[1] * (c.scale ?? 1) / 2;
      minX = Math.min(minX, c.x - s); maxX = Math.max(maxX, c.x + s);
      minY = Math.min(minY, c.y - s); maxY = Math.max(maxY, c.y + s);
    });
    animateCamera(fitBounds(minX, maxX, minY, maxY, 60, 1.3));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId]);

  // ── Drag state ───────────────────────────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingIdRef  = useRef<string | null>(null);
  // Current dragged bubble world position (updated during drag)
  const dragWX = useRef(0);
  const dragWY = useRef(0);
  const dragBubbleRef = useRef<BubbleData | null>(null);
  // Animated values for dragged bubble screen position (smooth on all platforms)
  const dragScreenX = useRef(new Animated.Value(0)).current;
  const dragScreenY = useRef(new Animated.Value(0)).current;

  // ── Gesture state ─────────────────────────────────────────────────────────────
  const touchStart      = useRef({ x: 0, y: 0, time: 0 });
  const cameraTouchStart = useRef({ x: 0, y: 0, scale: INIT_SCALE });
  const pinchStart      = useRef<{ dist: number; scale: number; x: number; y: number } | null>(null);
  const bubbleDragStart = useRef({ wx: 0, wy: 0 });
  const isDraggingBubble = useRef(false);

  // Hit test: find topmost visible bubble under screen point
  function hitTest(sx: number, sy: number): string | null {
    const cam = cameraRef.current;
    const { wx, wy } = toWorld(sx, sy, cam);
    const vis = visibleRef.current;
    const fid = focusedIdRef.current;
    const bid = byIdRef.current;
    for (let i = vis.length - 1; i >= 0; i--) {
      const b = vis[i];
      const size = getBubbleDisplaySize(b, fid, bid);
      const r = size / 2;
      const dx = wx - b.x, dy = wy - b.y;
      if (dx * dx + dy * dy <= r * r) return b.id;
    }
    return null;
  }

  // ── PanResponder ──────────────────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,

      onPanResponderGrant(evt) {
        cancelAnimationFrame(animFrameRef.current);
        const touches = evt.nativeEvent.touches;
        const t0 = touches[0];
        touchStart.current      = { x: t0.pageX, y: t0.pageY, time: Date.now() };
        cameraTouchStart.current = { ...cameraRef.current };
        pinchStart.current      = null;
        isDraggingBubble.current = false;

        if (touches.length >= 2) {
          draggingIdRef.current = null;
          const t1 = touches[1];
          const dx = t1.pageX - t0.pageX, dy = t1.pageY - t0.pageY;
          pinchStart.current = {
            dist:  Math.sqrt(dx * dx + dy * dy),
            scale: cameraRef.current.scale,
            x: cameraRef.current.x,
            y: cameraRef.current.y,
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
        }
      },

      onPanResponderMove(evt) {
        const touches = evt.nativeEvent.touches;

        if (touches.length >= 2 && pinchStart.current) {
          const t0 = touches[0], t1 = touches[1];
          const dx = t1.pageX - t0.pageX, dy = t1.pageY - t0.pageY;
          const dist  = Math.sqrt(dx * dx + dy * dy);
          const ratio = dist / pinchStart.current.dist;
          const newS  = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStart.current.scale * ratio));
          const midX  = (t0.pageX + t1.pageX) / 2;
          const midY  = (t0.pageY + t1.pageY) / 2;
          // Zoom around the midpoint: keep midpoint fixed in world space
          const { wx: focWX, wy: focWY } = toWorld(midX, midY, cameraRef.current);
          const newCam: Camera = {
            x: midX - focWX * newS,
            y: midY - focWY * newS,
            scale: newS,
          };
          applyCameraImmediate(newCam);
          return;
        }

        const t0 = touches[0];
        const dx = t0.pageX - touchStart.current.x;
        const dy = t0.pageY - touchStart.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > DRAG_THRESH && draggingIdRef.current) {
          if (!isDraggingBubble.current) {
            isDraggingBubble.current = true;
            const b = byIdRef.current[draggingIdRef.current];
            dragBubbleRef.current = b ?? null;
            setDraggingId(draggingIdRef.current);
          }
        }

        if (draggingIdRef.current && isDraggingBubble.current) {
          const s = cameraRef.current.scale;
          const newWX = bubbleDragStart.current.wx + dx / s;
          const newWY = bubbleDragStart.current.wy + dy / s;
          dragWX.current = newWX;
          dragWY.current = newWY;

          const fid = focusedIdRef.current;
          const bid = byIdRef.current;
          const b   = dragBubbleRef.current;
          if (b) {
            const size = getBubbleDisplaySize(b, fid, bid) * cameraRef.current.scale;
            const { sx, sy } = toScreen(newWX, newWY, cameraRef.current);
            dragScreenX.setValue(sx - size / 2);
            dragScreenY.setValue(sy - size / 2);
          }
        } else if (!draggingIdRef.current) {
          applyCameraImmediate({
            x:     cameraTouchStart.current.x + dx,
            y:     cameraTouchStart.current.y + dy,
            scale: cameraTouchStart.current.scale,
          });
        }
      },

      onPanResponderRelease(evt) {
        const t0  = evt.nativeEvent.changedTouches[0];
        const dx  = t0.pageX - touchStart.current.x;
        const dy  = t0.pageY - touchStart.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const dur  = Date.now() - touchStart.current.time;

        if (isDraggingBubble.current && draggingIdRef.current) {
          updatePosRef.current(draggingIdRef.current, { x: dragWX.current, y: dragWY.current });
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else if (dist < TAP_DIST && dur < TAP_MS) {
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

  // ── Render ───────────────────────────────────────────────────────────────────
  const cam = camera;
  const dragBubble = draggingId ? byId[draggingId] : null;

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      {/* Background gradient layer — must be first so it sits behind bubbles */}
      <LinearGradient
        colors={['#FAFAFA', '#EEEEF2']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Bubbles — rendered in screen space for Expo-Web compatibility */}
      {visibleBubbles.map(b => {
        if (draggingId === b.id) return null;
        const size     = getBubbleDisplaySize(b, focusedId, byId) * cam.scale;
        const layer    = relativeLayer(b.id, focusedId, byId);
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
          />
        );
      })}

      {/* Dragged bubble — uses Animated for butter-smooth movement */}
      {dragBubble && (() => {
        const size = getBubbleDisplaySize(dragBubble, focusedId, byId) * cam.scale;
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
            />
          </Animated.View>
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
});
