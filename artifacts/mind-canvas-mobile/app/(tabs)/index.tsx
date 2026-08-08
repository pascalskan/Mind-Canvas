import React, { useState } from 'react';
import {
  Platform, Pressable, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useBubbles } from '@/context/BubbleContext';
import CanvasView from '@/components/CanvasView';
import AddBubblePanel from '@/components/AddBubblePanel';
import EditBubblePanel from '@/components/EditBubblePanel';

export default function MainScreen() {
  const {
    bubbles, focusedId, editMode, editSelection,
    byId, setFocusedId, setEditMode, setEditSelection,
    exportMap, importMap,
  } = useBubbles();

  const insets  = useSafeAreaInsets();
  const [showAdd, setShowAdd] = useState(false);

  const isWeb      = Platform.OS === 'web';
  const topInset   = isWeb ? 67 : insets.top;
  const bottomInset = isWeb ? 34 : insets.bottom;

  // ── Breadcrumb ────────────────────────────────────────────────────────────────

  const breadcrumb: { id: string; label: string; color: string }[] = [];
  if (focusedId) {
    let cur = byId[focusedId];
    while (cur) {
      breadcrumb.unshift({ id: cur.id, label: cur.label, color: cur.color });
      cur = cur.parentId ? byId[cur.parentId] : undefined as any;
    }
  }

  // ── Edit mode handlers ────────────────────────────────────────────────────────

  const enterEdit = () => {
    setEditMode(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setEditSelection(null);
    Haptics.selectionAsync();
  };

  const doneEdit = () => {
    setEditMode(false);
    setEditSelection(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Infinite canvas */}
      <CanvasView />

      {/* ── Breadcrumb bar ───────────────────────────────────────────────── */}
      {breadcrumb.length > 0 && (
        <View style={[styles.breadcrumb, { top: topInset }]} pointerEvents="box-none">
          <View style={styles.breadcrumbInner} pointerEvents="auto">
            {/* Home button */}
            <TouchableOpacity
              onPress={() => { setFocusedId(null); Haptics.selectionAsync(); }}
              style={styles.breadcrumbHome}
            >
              <Feather name="home" size={14} color="#6b7280" />
            </TouchableOpacity>

            {breadcrumb.map((crumb, i) => (
              <React.Fragment key={crumb.id}>
                <Feather name="chevron-right" size={12} color="#d1d5db" style={styles.chevron} />
                <TouchableOpacity
                  onPress={() => {
                    setFocusedId(crumb.id);
                    Haptics.selectionAsync();
                  }}
                  style={styles.crumbBtn}
                >
                  <View style={[styles.crumbDot, { backgroundColor: crumb.color }]} />
                  <Text
                    style={[styles.crumbText, i === breadcrumb.length - 1 && styles.crumbTextActive]}
                    numberOfLines={1}
                  >
                    {crumb.label}
                  </Text>
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </View>
        </View>
      )}

      {/* ── Hint ────────────────────────────────────────────────────────── */}
      {!focusedId && !editMode && !showAdd && (
        <View style={[styles.hintWrap, { top: topInset + 10 }]} pointerEvents="none">
          <Text style={styles.hint}>tap a bubble to enter · pinch to zoom</Text>
        </View>
      )}

      {/* ── Toolbar — hidden only when the Add-bubble sheet is open ──── */}
      {!showAdd && (
      <View
        style={[styles.toolbar, { bottom: bottomInset + 16 }]}
        pointerEvents="box-none"
      >
        {editMode ? (
          <View style={styles.toolbarRow} pointerEvents="auto">
            {/* Delete / deselect visual cue */}
            <TouchableOpacity style={[styles.pill, styles.pillDanger]} onPress={cancelEdit}>
              <Feather name="x" size={16} color="#ef4444" />
              <Text style={[styles.pillText, { color: '#ef4444' }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.pill, styles.pillDone]} onPress={doneEdit}>
              <Feather name="check" size={16} color="#fff" />
              <Text style={[styles.pillText, { color: '#fff' }]}>Done</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.toolbarRow} pointerEvents="auto">
            {/* Import */}
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => { importMap(); Haptics.selectionAsync(); }}
            >
              <Feather name="upload" size={20} color="#6b7280" />
            </TouchableOpacity>
            {/* Export */}
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => { exportMap(); Haptics.selectionAsync(); }}
            >
              <Feather name="download" size={20} color="#6b7280" />
            </TouchableOpacity>
            {/* Edit */}
            <TouchableOpacity style={[styles.pill, styles.pillEdit]} onPress={enterEdit}>
              <Feather name="edit-2" size={14} color="#6b7280" />
              <Text style={[styles.pillText, { color: '#6b7280' }]}>Edit</Text>
            </TouchableOpacity>
            {/* Add */}
            <TouchableOpacity
              style={[styles.pill, styles.pillAdd]}
              onPress={() => { setShowAdd(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            >
              <Feather name="plus" size={16} color="#fff" />
              <Text style={[styles.pillText, { color: '#fff' }]}>Add bubble</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      )}

      {/* ── Edit bubble panel ────────────────────────────────────────────── */}
      {editMode && editSelection && (
        <EditBubblePanel bubbleId={editSelection} />
      )}

      {/* ── Add bubble panel ─────────────────────────────────────────────── */}
      {showAdd && (
        <AddBubblePanel onClose={() => setShowAdd(false)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  breadcrumb: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
    zIndex: 50,
  },
  breadcrumbInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 20,
    paddingHorizontal: 12,
    height: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
    maxWidth: '90%',
  },
  breadcrumbHome: {
    paddingHorizontal: 4,
    height: 36, justifyContent: 'center',
  },
  chevron: { marginHorizontal: 2 },
  crumbBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 4, height: 36, justifyContent: 'center',
  },
  crumbDot: { width: 8, height: 8, borderRadius: 4 },
  crumbText: {
    fontSize: 13, fontFamily: 'Inter_400Regular',
    color: '#9ca3af', maxWidth: 100,
  },
  crumbTextActive: { color: '#374151', fontFamily: 'Inter_500Medium' },
  hintWrap: {
    position: 'absolute',
    left: 0, right: 0, alignItems: 'center',
    zIndex: 10,
  },
  hint: {
    fontSize: 11, fontFamily: 'Inter_400Regular',
    color: '#9ca3af', letterSpacing: 0.8,
    opacity: 0.7,
  },
  toolbar: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
    zIndex: 50,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    height: 44,
    borderRadius: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 6,
    elevation: 4,
  },
  pillText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  pillEdit: {
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  pillAdd: {
    backgroundColor: 'rgba(90,80,110,0.85)',
  },
  pillDone: {
    backgroundColor: 'rgba(80,110,90,0.85)',
  },
  pillDanger: {
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  iconBtn: {
    width: 44, height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
});
