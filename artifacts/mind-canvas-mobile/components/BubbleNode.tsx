import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle, Defs, Ellipse, RadialGradient, Stop,
} from 'react-native-svg';
import { BubbleData } from '@/lib/bubbleTypes';
// The bounds, the fade curve and the pillar exemption live in bubbleLayout so
// web runs the identical rule and the contract test can hold the two to it.
import {
  LABEL_MIN_PX, LABEL_MAX_PX,
  labelZoomOpacity, pillarLabelIsCompact,
  archiveWash, ARCHIVE_FILL_KEEP, ARCHIVE_RING_KEEP,
  COMPLETE_FADE_MS, COMPLETE_FILL_MS, COMPLETE_POP_MS, COMPLETE_GLASS_OPACITY,
} from '@/lib/bubbleLayout';

interface Props {
  bubble:         BubbleData;
  size:           number;
  /** Screen-space center of the bubble */
  screenX:        number;
  screenY:        number;
  isFocused:      boolean;
  isSelected:     boolean;
  isGrandchild:   boolean;
  /** UN-scaled world display size, used for font-size so labels don't snap */
  worldDisplaySize?: number;
  /**
   * Archived, seen in the archive view among its live ancestors. Held to the
   * same numbers as the website's ARCHIVE_STYLE so a completed branch reads
   * the same on both.
   */
  ghosted?: boolean;
  /** Mid-completion: the glass empties, colour rises, then it pops. */
  completing?: boolean;
  /**
   * Shared 1 -> 0 opacity driving the hide-text view, owned by CanvasView so
   * every label on the canvas fades as one. Nested UNDER the label's own zoom
   * opacity rather than multiplied into it: React Native composites nested
   * opacities for free, so this stays a single native-driven node instead of
   * one Animated.multiply per bubble per frame.
   */
  labelReveal?: Animated.Value;
}

/** Glass sphere bubble. Positioned absolutely in screen space. */
export const BubbleNode = React.memo(function BubbleNode({
  bubble, size, screenX, screenY, isFocused, isSelected, isGrandchild, worldDisplaySize,
  labelReveal, ghosted, completing,
}: Props) {
  const r = size / 2;

  // One shot each, driven straight off the shared timings so the phone plays
  // the same completion the website does.
  const glass = useRef(new Animated.Value(1)).current;
  const fill  = useRef(new Animated.Value(0)).current;
  const pop   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!completing) return;
    const anim = Animated.sequence([
      // Opacity and transform can go native; height cannot, so the fill runs
      // on the JS driver. Different values, so mixing the two is safe.
      Animated.timing(glass, { toValue: COMPLETE_GLASS_OPACITY, duration: COMPLETE_FADE_MS, useNativeDriver: true }),
      Animated.timing(fill,  { toValue: 1,    duration: COMPLETE_FILL_MS, useNativeDriver: false }),
      Animated.timing(pop,   { toValue: 1,    duration: COMPLETE_POP_MS,  useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [completing, glass, fill, pop]);

  // Layer-2 grandchild → tiny coloured dot, no label, no chrome
  if (isGrandchild) {
    return (
      <View
        style={[
          styles.wrapper,
          { left: screenX - r, top: screenY - r, width: size, height: size },
        ]}
        pointerEvents="none"
      >
        <View
          style={{
            width: size,
            height: size,
            borderRadius: r,
            backgroundColor: bubble.color,
            opacity: 0.64,
          }}
        />
      </View>
    );
  }

  // Font-size is in screen pixels on React Native, so it must use the actual
  // rendered screen-space size. This scales continuously with camera.scale
  // during pinch, giving the same proportional feel as the web SVG labels.
  // `size` is already in SCREEN pixels (world size × camera scale), so these
  // bounds are literal on-screen sizes. Text still scales with the canvas
  // through the comfortable middle, but stops shrinking into illegibility when
  // zoomed out and stops ballooning when zoomed in. Matches the web clamp.
  // Pillars are the map's fixed points — the thing you orient by — so their
  // names survive BOTH ways a label can disappear here: the hide-text view and
  // the fade that strips labels off bubbles too small to hold them.
  const isPillar = bubble.depth === 0;

  const labelFontSize = Math.min(Math.max(size * 0.135, LABEL_MIN_PX), LABEL_MAX_PX);
  // Clamping alone would leave every distant bubble carrying a full-size label,
  // turning a zoomed-out canvas into overlapping text. Fade the label out once
  // its bubble is too small on screen to hold it — at that distance the bubble
  // reads as a shape, which is all it needs to be.
  const labelOpacity  = labelZoomOpacity(size, isPillar);
  const compactPillar = pillarLabelIsCompact(size, isPillar);

  // A pillar ignores the hide-text fade for the same reason it ignores the
  // distance one.
  const reveal = isPillar ? undefined : labelReveal;

  // Unique gradient IDs scoped to this bubble so SVG defs don't collide
  const uid = `b${bubble.id.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { left: screenX - r, top: screenY - r, width: size, height: size },
        completing ? {
          opacity:   pop.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.34] }) }],
        } : null,
      ]}
      pointerEvents="none"
    >
      {/* Archived: a pale wash of the bubble's own hue behind a dashed rim,
          at full opacity. Fading it instead would have cost the label first,
          since labels already fade with distance. */}
      {ghosted && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, {
            borderRadius: r,
            backgroundColor: archiveWash(bubble.color, ARCHIVE_FILL_KEEP),
            borderWidth: 2, borderStyle: 'dashed',
            borderColor: archiveWash(bubble.color, ARCHIVE_RING_KEEP),
          }]}
        />
      )}

      {/* Water rising to the brim, clipped to the sphere. The pale band along
          its top edge is the surface — without it the fill reads as a block
          sliding up rather than a bubble filling. */}
      {completing && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: r, overflow: 'hidden' }]}
        >
          <Animated.View style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            backgroundColor: bubble.color,
            opacity: 0.82,
            height: fill.interpolate({ inputRange: [0, 1], outputRange: [0, size] }),
          }}>
            <View style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              height: Math.max(2, size * 0.045),
              backgroundColor: '#ffffff', opacity: 0.3,
            }} />
          </Animated.View>
        </View>
      )}
      {/* ── SVG glass sphere ─────────────────────────────────────────────── */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: ghosted ? 0 : glass }]}
        pointerEvents="none"
      >
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        <Defs>
          {/* Body: white → color → color */}
          <RadialGradient id={`bg-${uid}`} cx="30%" cy="30%" r="70%">
            <Stop offset="0%"   stopColor="#ffffff" stopOpacity=".92" />
            <Stop offset="42%"  stopColor={bubble.color} stopOpacity=".88" />
            <Stop offset="100%" stopColor={bubble.color} stopOpacity="1" />
          </RadialGradient>
          {/* Rim: transparent → white → transparent */}
          <RadialGradient id={`rim-${uid}`} cx="50%" cy="50%" r="50%">
            <Stop offset="83%"  stopColor="#fff" stopOpacity="0" />
            <Stop offset="96%"  stopColor="#fff" stopOpacity=".88" />
            <Stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </RadialGradient>
          {/* Upper-left specular */}
          <RadialGradient id={`spec-${uid}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0%"   stopColor="#fff" stopOpacity=".92" />
            <Stop offset="28%"  stopColor="#fff" stopOpacity=".28" />
            <Stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </RadialGradient>
          {/* Lower-right glow */}
          <RadialGradient id={`glow-${uid}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0%"   stopColor={bubble.color} stopOpacity=".72" />
            <Stop offset="100%" stopColor={bubble.color} stopOpacity="0" />
          </RadialGradient>
        </Defs>

        {/* Body */}
        <Circle cx={r} cy={r} r={r - 1} fill={`url(#bg-${uid})`} />
        {/* Rim highlight */}
        <Circle cx={r} cy={r} r={r - 1} fill={`url(#rim-${uid})`} />
        {/* Lower-right glow */}
        <Circle cx={size * 0.64} cy={size * 0.68} r={size * 0.38} fill={`url(#glow-${uid})`} />
        {/* Upper-left specular ellipse (rotated −40°) */}
        <Ellipse
          cx={size * 0.28}
          cy={size * 0.24}
          rx={size * 0.17}
          ry={size * 0.10}
          fill={`url(#spec-${uid})`}
          transform={`rotate(-40, ${size * 0.28}, ${size * 0.24})`}
        />
      </Svg>
      </Animated.View>

      {/* ── Label ────────────────────────────────────────────────────────── */}
      {/* Container is centred in the square bounding box; maxWidth keeps text
          inside the circle at all zoom levels (matches web maxWidth: '84%'). */}
      <Animated.View
        style={[
          styles.labelContainer,
          reveal ? { opacity: reveal } : null,
          // The container clips to the bubble, which is exactly wrong once the
          // label is meant to sit across a marker smaller than itself.
          compactPillar ? { overflow: 'visible' } : null,
        ]}
        pointerEvents="none"
      >
        <Text
          style={[
            styles.label,
            { fontSize: labelFontSize, opacity: labelOpacity },
            compactPillar ? null : { maxWidth: size * 0.84 },
          ]}
          numberOfLines={compactPillar ? 1 : 2}
          allowFontScaling={false}
        >
          {bubble.label}
        </Text>
      </Animated.View>

      {/* ── Outer selection / focus ring ─────────────────────────────────── */}
      {(isSelected || isFocused) && (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.ring,
            {
              borderRadius: r,
              borderColor: isSelected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)',
              borderWidth:  isSelected ? 3 : 2,
            },
          ]}
        />
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
  },
  /** Fills the square bounding box and centres the label inside it. */
  labelContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  label: {
    textAlign: 'center',
    textAlignVertical: 'center',
    color: '#374151',
    fontFamily: 'Inter_300Light',
    fontWeight: '300' as const,
    letterSpacing: 0.5,
  },
  ring: {
    position: 'absolute',
  },
});
