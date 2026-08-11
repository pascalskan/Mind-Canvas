import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle, Defs, Ellipse, RadialGradient, Stop,
} from 'react-native-svg';
import { BubbleData } from '@/lib/bubbleTypes';

// Label legibility bounds, in on-screen pixels. Kept identical to the web
// values (LABEL_* in MindCanvas.tsx) so the same canvas reads the same way on
// both platforms.
const LABEL_MIN_PX = 11;
const LABEL_MAX_PX = 22;
const LABEL_FADE_FROM_PX = 52;   // fully visible at or above this screen diameter
const LABEL_FADE_TO_PX   = 28;   // fully transparent at or below

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
}

/** Glass sphere bubble. Positioned absolutely in screen space. */
export const BubbleNode = React.memo(function BubbleNode({
  bubble, size, screenX, screenY, isFocused, isSelected, isGrandchild, worldDisplaySize,
}: Props) {
  const r = size / 2;

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
  const labelFontSize = Math.min(Math.max(size * 0.135, LABEL_MIN_PX), LABEL_MAX_PX);
  // Clamping alone would leave every distant bubble carrying a full-size label,
  // turning a zoomed-out canvas into overlapping text. Fade the label out once
  // its bubble is too small on screen to hold it — at that distance the bubble
  // reads as a shape, which is all it needs to be.
  const labelOpacity =
    size >= LABEL_FADE_FROM_PX ? 1
    : size <= LABEL_FADE_TO_PX ? 0
    : (size - LABEL_FADE_TO_PX) / (LABEL_FADE_FROM_PX - LABEL_FADE_TO_PX);

  // Unique gradient IDs scoped to this bubble so SVG defs don't collide
  const uid = `b${bubble.id.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <View
      style={[styles.wrapper, { left: screenX - r, top: screenY - r, width: size, height: size }]}
      pointerEvents="none"
    >
      {/* ── SVG glass sphere ─────────────────────────────────────────────── */}
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

      {/* ── Label ────────────────────────────────────────────────────────── */}
      {/* Container is centred in the square bounding box; maxWidth keeps text
          inside the circle at all zoom levels (matches web maxWidth: '84%'). */}
      <View style={styles.labelContainer} pointerEvents="none">
        <Text
          style={[styles.label, { fontSize: labelFontSize, opacity: labelOpacity, maxWidth: size * 0.84 }]}
          numberOfLines={2}
          allowFontScaling={false}
        >
          {bubble.label}
        </Text>
      </View>

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
    </View>
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
