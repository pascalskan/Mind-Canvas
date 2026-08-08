import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Platform, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useBubbles } from '@/context/BubbleContext';
import { PILLAR_COLORS, SCALE_OPTIONS } from '@/lib/bubbleLayout';

interface Props {
  bubbleId: string;
}

export default function EditBubblePanel({ bubbleId }: Props) {
  const {
    byId, renameBubble, recolorBubble, resizeBubble, deleteBubble,
    setEditSelection, setEditMode, focusedId, setFocusedId,
  } = useBubbles();
  const insets = useSafeAreaInsets();

  const bubble = byId[bubbleId];
  const [label, setLabel] = useState(bubble?.label ?? '');
  const [color, setColor] = useState(bubble?.color ?? PILLAR_COLORS[0]);
  const [scale, setScale] = useState(bubble?.scale ?? 1.0);

  // Slide up
  const slideY = useRef(new Animated.Value(400)).current;
  useEffect(() => {
    Animated.spring(slideY, {
      toValue: 0, useNativeDriver: true, tension: 55, friction: 12,
    }).start();
  }, []);

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

      {/* Color swatch + bubble name */}
      <View style={styles.header}>
        <View style={[styles.colorDot, { backgroundColor: color }]} />
        <Text style={styles.depth}>
          depth {bubble.depth} {bubble.parentId ? '' : '· root'}
        </Text>
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

      {/* Delete */}
      <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
        <Text style={styles.deleteText}>Delete bubble</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
    alignSelf: 'center',
    paddingHorizontal: 24, height: 44,
    justifyContent: 'center',
  },
  deleteText: {
    fontSize: 14, fontFamily: 'Inter_400Regular',
    color: '#ef4444',
  },
});
