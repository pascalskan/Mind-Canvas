---
name: Mind Canvas RAF performance
description: Why the animation loop must use per-bubble MotionValues, not React state, and the two other rules that keep mobile smooth.
---

# Replace `setPositions` with per-bubble MotionValues

The original loop called `setPositions(pos)` every 16 ms, which triggered React to reconcile every visible bubble on every frame. On mobile this caused visible lag during panning.

**Fix:** create a `Map<id, {x: MotionValue, y: MotionValue}>` (stored in a ref). In the RAF tick, call `mv.x.set(...)` / `mv.y.set(...)` directly — Framer Motion writes the CSS transform to the DOM without going through React's reconciler.

**Why:** `MotionValue.set()` is a synchronous DOM write; `setState` schedules a React render. For purely cosmetic animation that runs every frame, React's reconciler is unnecessary overhead.

**How to apply:**
- Create MVs lazily during render (checked-in the render `.map()`). Use `motionValue(initX)` from framer-motion (the imperative function, not the `useMotionValue` hook).
- Store in a ref (`useRef<Map<…>>(new Map())`). Clean up stale entries in a `useEffect` that watches the bubbles array.
- In the RAF, skip MV updates when `isPanning.current` is true — the camera MotionValue already redraws everything; two competing transform writes per frame fight each other on mobile.
- Pass `mv.x` / `mv.y` as the `x` / `y` style props of the `motion.div`.

# Memoize CoordinateField

`CoordinateField` takes no props and its SVG is static (the only animation is a CSS SVG `<animate>` tag, not React). Wrap it in `memo()` so it never re-renders at all.

# RAF throttle

The tick compares `now - last < 16` (≈60 fps). This is fine after the MotionValue fix because calculation cost (layoutView + resolveCollisions) is low; the old bottleneck was React reconciliation, not computation.
