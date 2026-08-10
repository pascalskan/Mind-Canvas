import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Pressable, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useBubbles } from '@/context/BubbleContext';
import { PILLAR_COLORS, SCALE_OPTIONS } from '@/lib/bubbleLayout';
import { BubbleData, MAX_DEPTH } from '@/lib/bubbleTypes';
import { useSlideIn, slideOut } from '@/lib/animation';

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

  // ── Drill-down state ────────────────────────────────────────────────────────
  // viewingParentId: whose children we're currently browsing (null = root level)
  const [viewingParentId, setViewingParentId] = useState<string | null>(() => {
    if (initialParentId && byId[initialParentId]) {
      // Start at the level that contains the initial parent so it's visible
      return byId[initialParentId].parentId ?? null;
    }
    return null;
  });

  // ── Selected parent + form state ────────────────────────────────────────────
  const resolvedInitialParent = initialParentId ?? focusedId ?? null;
  const [parentId, setParentId] = useState<string | null>(resolvedInitialParent);
  const [color, setColor] = useState<string>(() => {
    const src = initialParentId ?? focusedId;
    if (src && byId[src]) return byId[src].color;
    return PILLAR_COLORS[0];
  });
  const [scale, setScale] = useState(1.0);
  const [label, setLabel] = useState('');

  const inputRef = useRef<TextInput>(null);

  // Slide up animation. useSlideIn guarantees the resting position even when
  // the animation is skipped — see lib/animation.ts.
  const slideY = useSlideIn(400);
  useEffect(() => {
    // Dismissing the panel quickly (e.g. tap-outside right after opening) can
    // unmount this component before the 350ms delay elapses; without cleanup
    // the timer still fires focus() on an unmounted TextInput.
    const t = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => slideOut(slideY, 400, onClose);

  const parent = parentId ? byId[parentId] : null;
  const atMax  = !!parent && parent.depth >= MAX_DEPTH;

  const submit = () => {
    const t = label.trim();
    if (!t || atMax) return;
    addBubble(t, parentId, { color, scale: scale !== 1.0 ? scale : undefined });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    dismiss();
  };

  // ── Current level bubbles ───────────────────────────────────────────────────
  const currentLevelBubbles = useMemo(() =>
    bubbles
      .filter(b => (b.parentId ?? null) === viewingParentId && b.depth < MAX_DEPTH)
      .sort((a, b) => a.label.localeCompare(b.label)),
    [bubbles, viewingParentId],
  );

  const viewingBubble = viewingParentId ? byId[viewingParentId] : null;
  const canGoBack     = viewingParentId !== null;

  function handleBack() {
    // Go up one level: show the parent of the bubble we were browsing
    setViewingParentId(viewingBubble?.parentId ?? null);
  }

  function handleChipPress(b: BubbleData) {
    if (parentId === b.id) {
      setParentId(null); // deselect → root
    } else {
      setParentId(b.id);
      setColor(b.color);
      Haptics.selectionAsync();
    }
  }

  function handleChipLongPress(b: BubbleData) {
    const hasChildren = bubbles.some(ch => ch.parentId === b.id && ch.depth < MAX_DEPTH);
    if (hasChildren) {
      setViewingParentId(b.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      // No children to explore — give feedback
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
  }

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const titleLabel = parent
    ? `Add child to "${parent.label}"`
    : viewingBubble
      ? `Inside "${viewingBubble.label}"`
      : 'New bubble';

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

        <Text style={styles.title}>{titleLabel}</Text>

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

        {/* Parent selector ── drill-down */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>Add to</Text>
          <Text style={styles.hint}>Tap to select · Hold to explore</Text>
        </View>

        {/* Back button when drilled in */}
        {canGoBack && (
          <TouchableOpacity style={styles.backRow} onPress={handleBack} activeOpacity={0.7}>
            <Text style={styles.backArrow}>‹</Text>
            <Text style={styles.backLabel}>
              {viewingBubble?.parentId
                ? byId[viewingBubble.parentId]?.label ?? 'Back'
                : 'Root level'}
            </Text>
          </TouchableOpacity>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.parentRow}
          contentContainerStyle={styles.parentRowContent}
        >
          {/* "Root level" chip only visible at root level */}
          {!canGoBack && (
            <ParentChip
              label="Root level"
              color="#aaa"
              selected={parentId === null}
              hasChildren={false}
              onPress={() => { setParentId(null); setColor(PILLAR_COLORS[0]); }}
              onLongPress={() => {}}
            />
          )}

          {currentLevelBubbles.map(b => {
            const hasChildren = bubbles.some(
              ch => ch.parentId === b.id && ch.depth < MAX_DEPTH,
            );
            return (
              <ParentChip
                key={b.id}
                label={b.label}
                color={b.color}
                selected={parentId === b.id}
                hasChildren={hasChildren}
                onPress={() => handleChipPress(b)}
                onLongPress={() => handleChipLongPress(b)}
              />
            );
          })}
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
  label, color, selected, hasChildren, onPress, onLongPress,
}: {
  label: string; color: string; selected: boolean;
  hasChildren: boolean; onPress: () => void; onLongPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.parentChip,
        { borderColor: color, backgroundColor: selected ? color : 'transparent' },
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={0.75}
    >
      <Text style={[styles.parentChipText, { color: selected ? '#fff' : color }]}>
        {label}
      </Text>
      {hasChildren && (
        <Text style={[styles.drillIcon, { color: selected ? 'rgba(255,255,255,0.7)' : color }]}>
          ›
        </Text>
      )}
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
  sectionRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11, fontFamily: 'Inter_500Medium',
    color: '#9ca3af', letterSpacing: 1.2, textTransform: 'uppercase',
  },
  hint: {
    fontSize: 10, fontFamily: 'Inter_400Regular',
    color: '#c4c9d4', fontStyle: 'italic',
  },
  backRow: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 8, paddingVertical: 4,
  },
  backArrow: {
    fontSize: 22, color: '#9ca3af', lineHeight: 24, marginRight: 4,
  },
  backLabel: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: '#9ca3af',
  },
  parentRow:        { maxHeight: 52, marginBottom: 12 },
  parentRowContent: { gap: 8, paddingRight: 4 },
  parentChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, height: 36, borderRadius: 18,
    borderWidth: 1.5, gap: 4,
  },
  parentChipText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  drillIcon:      { fontSize: 16, lineHeight: 20 },
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
