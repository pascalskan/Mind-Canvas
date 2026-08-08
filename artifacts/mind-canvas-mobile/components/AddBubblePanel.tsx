import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Pressable, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useBubbles } from '@/context/BubbleContext';
import { PILLAR_COLORS, SCALE_OPTIONS } from '@/lib/bubbleLayout';
import { BubbleData, MAX_DEPTH } from '@/lib/bubbleTypes';

interface Props {
  onClose: () => void;
  /**
   * When set (e.g. from a long-press on a bubble), the panel opens with this
   * bubble pre-selected as the parent — equivalent to Shift+click on the web.
   */
  initialParentId?: string | null;
}

export default function AddBubblePanel({ onClose, initialParentId }: Props) {
  const { bubbles, byId, addBubble, focusedId } = useBubbles();
  const insets = useSafeAreaInsets();

  // Resolve initial parent: prefer initialParentId, then focusedId, then null
  const resolvedInitialParent = initialParentId ?? focusedId ?? null;

  const [label,    setLabel]    = useState('');
  const [parentId, setParentId] = useState<string | null>(resolvedInitialParent);
  const [color, setColor] = useState<string>(() => {
    const src = initialParentId ?? focusedId;
    if (src && byId[src]) return byId[src].color;
    return PILLAR_COLORS[0];
  });
  const [scale, setScale] = useState(1.0);

  const inputRef = useRef<TextInput>(null);

  // Slide up animation
  const slideY = useRef(new Animated.Value(400)).current;
  useEffect(() => {
    Animated.spring(slideY, {
      toValue: 0, useNativeDriver: true, tension: 55, friction: 12,
    }).start();
    setTimeout(() => inputRef.current?.focus(), 350);
  }, []);

  const dismiss = () => {
    Animated.timing(slideY, {
      toValue: 400, duration: 220, useNativeDriver: true,
    }).start(onClose);
  };

  const parent = parentId ? byId[parentId] : null;
  const atMax  = !!parent && parent.depth >= MAX_DEPTH;

  const submit = () => {
    const t = label.trim();
    if (!t || atMax) return;
    addBubble(t, parentId, { color, scale: scale !== 1.0 ? scale : undefined });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    dismiss();
  };

  // Build the full parent list: depth-first walk, excluding bubbles at MAX_DEPTH
  // (they can't have children). Each entry carries a depth for indentation.
  const parentOptions = React.useMemo(() => {
    const result: { bubble: BubbleData; depth: number }[] = [];
    function walk(parentId: string | null, depth: number) {
      const children = bubbles
        .filter(b => (b.parentId ?? null) === parentId)
        .sort((a, b) => a.label.localeCompare(b.label));
      for (const b of children) {
        result.push({ bubble: b, depth });
        if (b.depth < MAX_DEPTH) walk(b.id, depth + 1);
      }
    }
    walk(null, 0);
    return result.filter(({ bubble }) => bubble.depth < MAX_DEPTH);
  }, [bubbles]);

  const initialParent = initialParentId ? byId[initialParentId] : null;
  const showSpecial   = initialParent && initialParent.depth > 0;

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <>
      {/* Backdrop */}
      <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />

      <Animated.View
        style={[
          styles.panel,
          { paddingBottom: bottomPad + 16, transform: [{ translateY: slideY }] },
        ]}
      >
        {/* Handle bar */}
        <View style={styles.handle} />

        <Text style={styles.title}>
          {showSpecial ? `Add child to "${initialParent?.label}"` : 'New bubble'}
        </Text>

        {/* Label input */}
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Label…"
          placeholderTextColor="#bbb"
          value={label}
          onChangeText={setLabel}
          onSubmitEditing={submit}
          returnKeyType="done"
          maxLength={60}
        />

        {/* Parent selector */}
        <Text style={styles.sectionLabel}>Add to</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.parentRow}
          contentContainerStyle={styles.parentRowContent}
        >
          <ParentChip
            label="Root level"
            color="#aaa"
            selected={parentId === null}
            onPress={() => { setParentId(null); setColor(PILLAR_COLORS[0]); }}
          />

          {/* Full tree — every bubble that can accept children */}
          {parentOptions.map(({ bubble: b, depth }) => (
            <ParentChip
              key={b.id}
              label={b.label}
              color={b.color}
              depth={depth}
              selected={parentId === b.id}
              onPress={() => { setParentId(b.id); setColor(b.color); Haptics.selectionAsync(); }}
            />
          ))}
        </ScrollView>

        {atMax && (
          <Text style={styles.atMaxWarning}>Maximum depth reached for this bubble.</Text>
        )}

        {/* Color picker */}
        <Text style={styles.sectionLabel}>Color</Text>
        <View style={styles.colorRow}>
          {PILLAR_COLORS.map(c => (
            <TouchableOpacity
              key={c}
              style={[styles.swatch, { backgroundColor: c, borderWidth: color === c ? 3 : 0 }]}
              onPress={() => { setColor(c); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            />
          ))}
        </View>

        {/* Size picker */}
        <Text style={styles.sectionLabel}>Size</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.sizeRow}
          contentContainerStyle={styles.sizeRowContent}
        >
          {SCALE_OPTIONS.map(s => (
            <TouchableOpacity
              key={s}
              style={[styles.sizeChip, scale === s && styles.sizeChipSelected]}
              onPress={() => { setScale(s); Haptics.selectionAsync(); }}
            >
              <Text style={[styles.sizeChipText, scale === s && styles.sizeChipTextSelected]}>
                {Math.round(s * 100)}%
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Status line */}
        <Text style={styles.status}>
          {atMax   ? `Max depth for ${parent?.label ?? ''}`
          : parent  ? `→ child of ${parent.label}`
          : '→ new root bubble'}
        </Text>

        {/* Action buttons */}
        <View style={styles.buttons}>
          <TouchableOpacity style={styles.cancelBtn} onPress={dismiss}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.addBtn,
              { backgroundColor: color },
              (!label.trim() || atMax) && styles.addBtnDisabled,
            ]}
            onPress={submit}
            disabled={!label.trim() || atMax}
          >
            <Text style={styles.addText}>Add</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </>
  );
}

function ParentChip({
  label, color, depth = 0, selected, onPress,
}: { label: string; color: string; depth?: number; selected: boolean; onPress: () => void }) {
  const prefix = depth > 0 ? '›'.repeat(depth) + ' ' : '';
  return (
    <TouchableOpacity
      style={[
        styles.parentChip,
        { borderColor: color, backgroundColor: selected ? color : 'transparent',
          marginLeft: depth * 4 },
      ]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Text style={[styles.parentChipText, { color: selected ? '#fff' : color }]}>
        {prefix}{label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(252,252,254,0.97)',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 12,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#d1d5db', alignSelf: 'center', marginBottom: 16,
  },
  title: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold',
    color: '#999', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12,
  },
  input: {
    fontSize: 18, fontFamily: 'Inter_400Regular', color: '#1a1a1a',
    borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
    paddingVertical: 8, marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 11, fontFamily: 'Inter_500Medium',
    color: '#9ca3af', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8,
  },
  parentRow:        { maxHeight: 52, marginBottom: 12 },
  parentRowContent: { gap: 8, paddingRight: 4 },
  parentChip: {
    paddingHorizontal: 14, height: 36, borderRadius: 18,
    borderWidth: 1.5, justifyContent: 'center',
  },
  parentChipText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  atMaxWarning:   { fontSize: 12, color: '#ef4444', marginBottom: 8 },
  colorRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  swatch: {
    width: 44, height: 44, borderRadius: 22, borderColor: 'rgba(255,255,255,0.9)',
  },
  sizeRow:         { maxHeight: 44, marginBottom: 12 },
  sizeRowContent:  { gap: 8, paddingRight: 4 },
  sizeChip: {
    paddingHorizontal: 14, height: 36, borderRadius: 18,
    borderWidth: 1.5, borderColor: '#e5e7eb', justifyContent: 'center', alignItems: 'center',
  },
  sizeChipSelected:     { backgroundColor: '#1a1a1a', borderColor: '#1a1a1a' },
  sizeChipText:         { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#666' },
  sizeChipTextSelected: { color: '#fff' },
  status: {
    fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9ca3af', marginBottom: 16,
  },
  buttons:    { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  cancelBtn:  { paddingHorizontal: 20, height: 44, justifyContent: 'center', alignItems: 'center' },
  cancelText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: '#9ca3af' },
  addBtn: {
    paddingHorizontal: 28, height: 44, borderRadius: 22,
    justifyContent: 'center', alignItems: 'center',
  },
  addBtnDisabled: { opacity: 0.35 },
  addText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#fff' },
});
