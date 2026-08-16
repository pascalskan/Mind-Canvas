import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Platform, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useBubbles } from '@/context/BubbleContext';
import { PILLAR_COLORS, SCALE_OPTIONS } from '@/lib/bubbleLayout';
import { useSlideIn } from '@/lib/animation';

interface Props {
  bubbleId: string;
  /** When true the label TextInput is auto-focused (e.g. opened via double-tap). */
  focusLabel?: boolean;
}

export default function EditBubblePanel({ bubbleId, focusLabel }: Props) {
  const {
    byId, bubbles, renameBubble, recolorBubble, resizeBubble, deleteBubble,
    completeBubble,
    setEditSelection, focusedId, setFocusedId,
  } = useBubbles();
  const insets = useSafeAreaInsets();

  const bubble = byId[bubbleId];
  const [label, setLabel] = useState(bubble?.label ?? '');
  const [color, setColor] = useState(bubble?.color ?? PILLAR_COLORS[0]);
  const [scale, setScale] = useState(bubble?.scale ?? 1.0);

  // Slide up. useSlideIn guarantees the resting position even when the
  // animation is skipped — see lib/animation.ts.
  const slideY = useSlideIn(400);

  if (!bubble) return null;

  const handleRename = () => {
    const t = label.trim();
    if (t && t !== bubble.label) renameBubble(bubbleId, t);
  };

  const handleRecolor = (c: string) => {
    setColor(c);
    recolorBubble(bubbleId, c);
    Haptics.selectionAsync();
  };

  const handleResize = (s: number) => {
    setScale(s);
    resizeBubble(bubbleId, s);
    Haptics.selectionAsync();
  };

  /**
   * Completing takes the bubble and everything under it off the canvas.
   *
   * The counts go in the prompt because they are the whole reason to ask: the
   * bubble you tapped may be one of twenty that disappear together.
   */
  const handleComplete = () => {
    const family = new Set<string>([bubbleId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const b of bubbles) {
        if (b.parentId && family.has(b.parentId) && !family.has(b.id)) {
          family.add(b.id); grew = true;
        }
      }
    }
    const inside = family.size - 1;
    const notes = bubbles
      .filter(b => family.has(b.id))
      .reduce((n, b) => n + (b.notes?.length ?? 0), 0);

    Alert.alert(
      `Complete "${bubble.label}"?`,
      `${family.size} bubble${family.size === 1 ? '' : 's'}`
      + (inside > 0 ? ` — this one and ${inside} inside it` : '')
      + (notes > 0 ? `, and ${notes} note${notes === 1 ? '' : 's'} written on them` : '')
      + ' will be stored in the archive.\n\n'
      + 'They leave the canvas but nothing is deleted — Show archived brings '
      + 'them back into view at any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete', onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            completeBubble(bubbleId);
          },
        },
      ],
    );
  };

  const handleDelete = () => {
    Alert.alert(
      `Delete "${bubble.label}"?`,
      'This will also remove all nested bubbles.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            if (focusedId === bubbleId) setFocusedId(null);
            deleteBubble(bubbleId);
            setEditSelection(null);
          },
        },
      ],
    );
  };

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <Animated.View style={[styles.panel, { paddingBottom: bottomPad + 16, transform: [{ translateY: slideY }] }]}>
      {/* Handle */}
      <View style={styles.handle} />

      {/* Color swatch + bubble name + delete */}
      <View style={styles.header}>
        <View style={[styles.colorDot, { backgroundColor: color }]} />
        <Text style={styles.depth}>
          depth {bubble.depth} {bubble.parentId ? '' : '· root'}
        </Text>
        <TouchableOpacity style={styles.completeBtn} onPress={handleComplete}>
          <Feather name="check" size={14} color="hsl(150,32%,34%)" />
          <Text style={styles.completeText}>Complete</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>

      {/* Rename */}
      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        onBlur={handleRename}
        onSubmitEditing={handleRename}
        returnKeyType="done"
        maxLength={60}
        placeholder="Label…"
        placeholderTextColor="#bbb"
        autoFocus={!!focusLabel}
        selectTextOnFocus={!!focusLabel}
      />

      {/* Color picker */}
      <Text style={styles.sectionLabel}>Color</Text>
      <View style={styles.colorRow}>
        {PILLAR_COLORS.map(c => (
          <TouchableOpacity
            key={c}
            style={[styles.swatch, { backgroundColor: c, borderWidth: color === c ? 3 : 0 }]}
            onPress={() => handleRecolor(c)}
            activeOpacity={0.8}
          />
        ))}
      </View>

      {/* Size */}
      <Text style={styles.sectionLabel}>Size</Text>
      <View style={styles.sizeRow}>
        {SCALE_OPTIONS.map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.sizeChip, scale === s && styles.sizeChipSel]}
            onPress={() => handleResize(s)}
          >
            <Text style={[styles.sizeText, scale === s && styles.sizeTextSel]}>
              {Math.round(s * 100)}%
            </Text>
          </TouchableOpacity>
        ))}
      </View>

    </Animated.View>
  );
}

const styles = StyleSheet.create({
  completeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, height: 34, borderRadius: 17,
    backgroundColor: 'hsl(150,38%,94%)',
  },
  completeText: {
    fontSize: 13, fontFamily: 'Inter_500Medium', color: 'hsl(150,32%,34%)',
  },
  panel: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(252,252,254,0.97)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 12,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#d1d5db',
    alignSelf: 'center', marginBottom: 12,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12,
    justifyContent: 'space-between',
  },
  colorDot: {
    width: 16, height: 16, borderRadius: 8,
  },
  depth: {
    fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9ca3af',
  },
  input: {
    fontSize: 18, fontFamily: 'Inter_400Regular', color: '#1a1a1a',
    borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
    paddingVertical: 8, marginBottom: 14,
  },
  sectionLabel: {
    fontSize: 11, fontFamily: 'Inter_500Medium',
    color: '#9ca3af', letterSpacing: 1.2, textTransform: 'uppercase',
    marginBottom: 8,
  },
  colorRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14,
  },
  swatch: {
    width: 44, height: 44, borderRadius: 22,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  sizeRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16,
  },
  sizeChip: {
    paddingHorizontal: 14, height: 36, borderRadius: 18,
    borderWidth: 1.5, borderColor: '#e5e7eb',
    justifyContent: 'center', alignItems: 'center',
  },
  sizeChipSel: { backgroundColor: '#1a1a1a', borderColor: '#1a1a1a' },
  sizeText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#666' },
  sizeTextSel: { color: '#fff' },
  deleteBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  deleteText: {
    fontSize: 13, fontFamily: 'Inter_400Regular',
    color: '#ef4444',
  },
});
