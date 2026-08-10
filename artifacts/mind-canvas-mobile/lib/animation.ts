import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Platform } from 'react-native';

/**
 * Whether `Animated` may drive a transform on the native thread.
 *
 * Always false on web: there is no native animated module there, so RN logs a
 * warning and falls back to JS anyway. Asking for it only produces noise.
 */
export const USE_NATIVE_DRIVER = Platform.OS !== 'web';

/**
 * Best-effort synchronous read of the "reduce motion" preference.
 *
 * Web can answer immediately via matchMedia. Native cannot — `AccessibilityInfo`
 * is async — so it starts false and is corrected by the effect below on the
 * first mount. Being briefly wrong there is harmless: `useSlideIn` settles the
 * value to its final position either way.
 */
let reduceMotion =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (Platform.OS !== 'web') {
  AccessibilityInfo.isReduceMotionEnabled()
    .then((enabled) => { reduceMotion = enabled; })
    .catch(() => { /* leave it false — the fallback below still protects us */ });
}

/**
 * A panel that slides in from `from` and rests at 0.
 *
 * **The resting position must not depend on the animation running.** Every
 * sliding panel in this app used to hold its offset in an `Animated.Value` that
 * only reached 0 because a spring drove it there — so when the spring did not
 * run, the panel rendered exactly where it was supposed to slide FROM and
 * simply stayed there. That is not hypothetical: RN disables `Animated` when
 * the OS or browser has "reduce motion" turned on, and it disables it by
 * skipping the animation, not by jumping to the end.
 *
 * The result was a Settings sheet sitting 400px down with a ~25px sliver
 * visible, and a "new save available" prompt sitting 140px above the top of the
 * screen with its "Open recent save" button off-screen entirely — a prompt that
 * could not be answered without reloading. Nothing errored. The elements were
 * present, laid out, and correctly populated; they were just somewhere the user
 * could not reach. Anyone browsing with reduced motion on — a real
 * accessibility setting, not an exotic one — met an unusable app.
 *
 * So this hook guarantees the end state three ways: it starts at 0 outright
 * when reduce-motion is known to be on, it settles to 0 in the animation's
 * completion callback (which still fires when the animation is skipped), and
 * it settles to 0 on unmount-safety via the cleanup. The slide is decoration;
 * position 0 is the contract.
 */
export function useSlideIn(from: number): Animated.Value {
  const value = useRef(new Animated.Value(reduceMotion ? 0 : from)).current;

  useEffect(() => {
    if (reduceMotion) {
      value.setValue(0);
      return;
    }
    const anim = Animated.spring(value, {
      toValue: 0,
      useNativeDriver: USE_NATIVE_DRIVER,
      tension: 55,
      friction: 12,
    });
    // The callback runs whether the spring finished, was interrupted, or was
    // never allowed to run at all — so this is the belt to the braces above.
    anim.start(() => value.setValue(0));
    return () => anim.stop();
  }, [value]);

  return value;
}

/**
 * Slides a panel back out to `to` and then runs `after` (typically unmounting
 * it). Skips straight to the callback under reduce-motion, so dismissing never
 * depends on an animation that may not run.
 */
export function slideOut(value: Animated.Value, to: number, after: () => void): void {
  if (reduceMotion) {
    after();
    return;
  }
  Animated.timing(value, { toValue: to, duration: 220, useNativeDriver: USE_NATIVE_DRIVER })
    .start(after);
}
