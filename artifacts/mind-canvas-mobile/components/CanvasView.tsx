import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useBubbles } from '@/context/BubbleContext';
import { BubbleNode } from '@/components/BubbleNode';
import { CanvasBackground } from '@/components/CanvasBackground';
import {
  getBubbleDisplaySize, isInThreeLayerView, relativeLayer,
  LAYER_SIZES_OVERVIEW, LAYER_SIZES_FOCUSED, getAllDescendants,
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

// Match web constants exactly: overview maxScale=0.9 pad=90, focused maxScale=1.6 pad=110
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

export default function CanvasView() {
  const {
    bubbles, focusedId, editMode, editSelection,
    setFocusedId, setEditSelection, updateBubblePosition, byId,
  } = useBubbles();

  // ── Camera ──────────────────────────────────────────────────────────────────
  const cameraRef = useRef<Camera>({ x: SW / 2, y: SH / 2, scale: INIT_SCALE });
  const [camera,  setCamera]  = useState<Camera>({ x: SW / 2, y: SH / 2, scale: INIT_SCALE });

  function applyCameraImmediate(cam: Camera) {
    cameraRef.current = cam;
    setCamera({ ...cam });
  }

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
  // Mirrors web fitLayout: include ALL visible three-layer nodes with their
  // rendered radii (getBubbleDisplaySize) rather than only roots or direct children.
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

    if (!fid) {
      // Overview: web uses maxScale=0.9, padding=90
      animateCamera(fitBounds(minX, maxX, minY, maxY, 90, 0.9));
    } else {
      // Focused: web uses maxScale=1.6, padding=110
      animateCamera(fitBounds(minX, maxX, minY, maxY, 110, 1.6));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId]);

  // ── Drag state ───────────────────────────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingIdRef  = useRef<string | null>(null);
  const dragWX = useRef(0);
  const dragWY = useRef(0);
  const dragBubbleRef = useRef<BubbleData | null>(null);
  const dragScreenX = useRef(new Animated.Value(0)).current;
  const dragScreenY = useRef(new Animated.Value(0)).current;

  // ── Gesture state ─────────────────────────────────────────────────────────────
  const touchStart       = useRef({ x: 0, y: 0, time: 0 });
  const cameraTouchStart = useRef({ x: 0, y: 0, scale: INIT_SCALE });
  // pinchStart stores the saved scale at grant time; dist/x/y update each frame
  const pinchStart      = useRef<{ savedScale: number; dist: number; x: number; y: number } | null>(null);
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
        touchStart.current       = { x: t0.pageX, y: t0.pageY, time: Date.now() };
        cameraTouchStart.current = { ...cameraRef.current };
        pinchStart.current       = null;
        isDraggingBubble.current = false;

        if (touches.length >= 2) {
          draggingIdRef.current = null;
          const t1 = touches[1];
          const dx = t1.pageX - t0.pageX, dy = t1.pageY - t0.pageY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          pinchStart.current = {
            savedScale: cameraRef.current.scale,
            dist,
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
        }
      },

      onPanResponderMove(evt) {
        const touches = evt.nativeEvent.touches;

        if (touches.length >= 2) {
          const t0 = touches[0], t1 = touches[1];
          const dx = t1.pageX - t0.pageX, dy = t1.pageY - t0.pageY;
          const dist  = Math.sqrt(dx * dx + dy * dy);
          const midX  = (t0.pageX + t1.pageX) / 2;
          const midY  = (t0.pageY + t1.pageY) / 2;

          if (!pinchStart.current) {
            // Fingers joined mid-gesture: initialise from current state
            pinchStart.current = {
              savedScale: cameraRef.current.scale,
              dist,
              x: midX,
              y: midY,
            };
            return;
          }

          // Scale relative to the saved scale at grant time, using current dist
          const ratio = dist / pinchStart.current.dist;
          const newS  = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStart.current.savedScale * ratio));

          // Zoom around the current midpoint: keep that world point fixed
          const { wx: focWX, wy: focWY } = toWorld(midX, midY, cameraRef.current);
          const newCam: Camera = {
            x: midX - focWX * newS,
            y: midY - focWY * newS,
            scale: newS,
          };
          // Update dist and midpoint each frame for continuous pinch+pan
          pinchStart.current.dist = dist;
          pinchStart.current.savedScale = newS;
          pinchStart.current.x = midX;
          pinchStart.current.y = midY;

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
          const draggedId = draggingIdRef.current;
          const newX = dragWX.current;
          const newY = dragWY.current;
          const startX = bubbleDragStart.current.wx;
          const startY = bubbleDragStart.current.wy;
          const deltaX = newX - startX;
          const deltaY = newY - startY;

          // Move the dragged bubble
          updatePosRef.current(draggedId, { x: newX, y: newY });

          // Move all descendants by the same delta (subtree drag)
          const allBubbles = bubblesRef.current;
          const descendants = getAllDescendants(draggedId, allBubbles);
          const bid = byIdRef.current;
          descendants.forEach(descId => {
            const desc = bid[descId];
            if (desc) {
              updatePosRef.current(descId, { x: desc.x + deltaX, y: desc.y + deltaY });
            }
          });

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
      {/* SVG coordinate field background — sits behind all bubbles */}
      <CanvasBackground camera={cam} screenWidth={SW} screenHeight={SH} />

      {/* Bubbles — rendered in screen space for Expo-Web compatibility */}
      {visibleBubbles.map(b => {
        if (draggingId === b.id) return null;
        const worldDisplaySize = getBubbleDisplaySize(b, focusedId, byId);
        const size     = worldDisplaySize * cam.scale;
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
            worldDisplaySize={worldDisplaySize}
          />
        );
      })}

      {/* Dragged bubble — uses Animated for butter-smooth movement */}
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
