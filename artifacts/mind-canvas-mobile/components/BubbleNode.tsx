import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BubbleData } from '@/lib/bubbleTypes';

interface Props {
  bubble:      BubbleData;
  size:        number;
  /** Screen-space center of the bubble */
  screenX:     number;
  screenY:     number;
  isFocused:   boolean;
  isSelected:  boolean;
  isGrandchild: boolean;
}

/** Glass sphere bubble. Positioned absolutely in screen space. */
export const BubbleNode = React.memo(function BubbleNode({
  bubble, size, screenX, screenY, isFocused, isSelected, isGrandchild,
}: Props) {
  const r = size / 2;
  const labelFontSize = Math.max(9, Math.min(15, size * 0.12));

  return (
    <View
      style={[styles.wrapper, { left: screenX - r, top: screenY - r, width: size, height: size }]}
      pointerEvents="none"
    >
      {/* ── Main sphere ──────────────────────────────────────────────────── */}
      <View
        style={[
          styles.sphere,
          {
            borderRadius: r,
            backgroundColor: bubble.color,
            shadowColor: bubble.color,
            shadowRadius: r * 0.35,
          },
          isFocused  && styles.focusedSphere,
          isSelected && styles.selectedSphere,
        ]}
      >
        {/* Top specular highlight */}
        <View
          style={[
            styles.highlight,
            {
              width:  size * 0.44,
              height: size * 0.22,
              borderRadius: size * 0.12,
              top:  size * 0.10,
              left: size * 0.20,
            },
          ]}
        />
        {/* Bottom rim */}
        <View
          style={[
            styles.rimLight,
            {
              width:  size * 0.28,
              height: size * 0.10,
              borderRadius: size * 0.05,
              bottom: size * 0.11,
              right:  size * 0.14,
            },
          ]}
        />
      </View>

      {/* ── Label ────────────────────────────────────────────────────────── */}
      {!isGrandchild && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Text
            style={[styles.label, { fontSize: labelFontSize }]}
            numberOfLines={2}
            allowFontScaling={false}
          >
            {bubble.label}
          </Text>
        </View>
      )}

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
  sphere: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.80,
    overflow: 'hidden',
    elevation: 6,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
  },
  focusedSphere: {
    opacity: 0.92,
  },
  selectedSphere: {
    opacity: 0.90,
  },
  highlight: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.52)',
    transform: [{ rotate: '-22deg' }],
  },
  rimLight: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  label: {
    flex: 1,
    textAlign: 'center',
    textAlignVertical: 'center',
    color: '#fff',
    fontFamily: 'Inter_400Regular',
    fontWeight: '300' as const,
    paddingHorizontal: 6,
    // Center vertically
    alignSelf: 'center',
    marginTop: 'auto',
    marginBottom: 'auto',
  },
  ring: {
    position: 'absolute',
  },
});
