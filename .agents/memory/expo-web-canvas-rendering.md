---
name: Expo Web canvas rendering
description: How to correctly render a pan/zoom canvas in Expo (works on both native and web)
---

# Expo Web canvas rendering

## The rule
Do NOT use a large absolutely-positioned world container with a CSS/Animated transform to implement a pan-zoom canvas in Expo. Use **screen-space rendering** instead: compute each element's screen position in JS (`screenX = worldX * scale + camX`) and render with `position: absolute; left: screenX; top: screenY`.

**Why:** Expo Web maps `Animated` transforms to CSS transforms. CSS transforms compose differently from React Native native:
- Native: each array entry moves in parent/screen space independently
- Web (CSS): `scale(s) translateX(tx)` shifts the element by `tx * s` screen pixels, not `tx`

Both bugs bit us:
1. `position: absolute; left: -2000; top: -2000` on the world container caused `overflow: hidden` on the parent to clip based on the LAYOUT position (before transform), making all bubbles invisible.
2. After removing overflow, the transform order `[{scale}, {translateX}, {translateY}]` placed bubbles at `(worldX*s + camX*s, worldY*s + camY*s)` instead of `(worldX*s + camX, worldY*s + camY)` on web.

## How to apply
```tsx
// Camera state — plain JS object, updated via setState (triggers re-renders)
const [camera, setCamera] = useState<{x:number; y:number; scale:number}>(...);

// Each bubble rendered in screen space:
const sx = bubble.worldX * camera.scale + camera.x;
const sy = bubble.worldY * camera.scale + camera.y;
const size = bubbleWorldSize * camera.scale;
return <BubbleNode style={{ position:'absolute', left: sx - size/2, top: sy - size/2, width: size, height: size }} />;
```

For smooth panning: use a `useRef` camera for gesture math (avoids stale closures), call `setState` with every frame during gestures. For spring animations on focus-change, use a `requestAnimationFrame` lerp loop.

For dragging a single element smoothly: use `Animated.Value` for just that element's `left`/`top` (avoids re-rendering all other bubbles).

## Files
- `artifacts/mind-canvas-mobile/components/CanvasView.tsx` — full implementation
- `artifacts/mind-canvas-mobile/components/BubbleNode.tsx` — receives `screenX`, `screenY`
