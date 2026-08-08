import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    cloudSaveOk,
    exportMap, importMap, forceSyncFromCloud,
  } = useBubbles();

  const insets = useSafeAreaInsets();
  const [showAdd, setShowAdd]           = useState(false);
  const [addParentId, setAddParentId]   = useState<string | null>(null);
  const [focusEditLabel, setFocusEditLabel] = useState(false);
  // Tracks whether the current focusEditLabel=true was consumed at mount time,
  // so a subsequent editSelection change (single-tap in edit mode) won't
  // unexpectedly auto-focus the next panel.
  const doubleTapPendingRef = useRef(false);

  useEffect(() => {
    if (doubleTapPendingRef.current) {
      // The panel just mounted with autoFocus — clear the pending flag and
      // reset the state flag so future single-tap panels open without focus.
      doubleTapPendingRef.current = false;
      setFocusEditLabel(false);
    }
  }, [editSelection]);

  const isWeb       = Platform.OS === 'web';
  const topInset    = isWeb ? 67 : insets.top;
  const bottomInset = isWeb ? 34 : insets.bottom;

  // ── Breadcrumb ─────────────────────────────────────────────────────────────
  // Build full ancestor chain, then show at most the 3 most-recent levels.
  // If there are more, show a single "…" button that jumps to the oldest
  // visible crumb's parent so the user can still navigate up quickly.
  // Memoised so unrelated renders do not recompute or produce transient values.

  const CRUMB_LIMIT = 3;

  const { breadcrumb, hasEllipsis, ellipsisTargetId } = useMemo(() => {
    const full: { id: string; label: string; color: string }[] = [];
    if (focusedId) {
      let cur = byId[focusedId];
      while (cur) {
        full.unshift({ id: cur.id, label: cur.label, color: cur.color });
        cur = cur.parentId ? byId[cur.parentId] : undefined as any;
      }
    }
    const ellipsis = full.length > CRUMB_LIMIT;
    const visible  = ellipsis ? full.slice(-CRUMB_LIMIT) : full;
    // Parent of the oldest visible crumb — where "…" should navigate to.
    const targetId = ellipsis ? (byId[visible[0].id]?.parentId ?? null) : null;
    return { breadcrumb: visible, hasEllipsis: ellipsis, ellipsisTargetId: targetId };
  }, [focusedId, byId]);

  // ── Edit handlers ──────────────────────────────────────────────────────────

  const enterEdit = () => {
    setEditMode(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };
  const cancelEdit = () => {
    setEditMode(false); setEditSelection(null); setFocusEditLabel(false); Haptics.selectionAsync();
  };
  const doneEdit = () => {
    setEditMode(false); setEditSelection(null); setFocusEditLabel(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // ── Long-press: add child of tapped bubble ─────────────────────────────────

  const handleLongPressAddChild = useCallback((parentId: string) => {
    setAddParentId(parentId);
    setShowAdd(true);
  }, []);

  const handleDoubleTapBubble = useCallback((id: string) => {
    doubleTapPendingRef.current = true;
    setEditMode(true);
    setEditSelection(id);
    setFocusEditLabel(true);
  }, [setEditMode, setEditSelection]);

  const closeAddPanel = useCallback(() => {
    setShowAdd(false);
    setAddParentId(null);
  }, []);

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Infinite canvas */}
      <CanvasView
        onLongPressAddChild={handleLongPressAddChild}
        onDoubleTapBubble={handleDoubleTapBubble}
      />

      {/* ── Breadcrumb bar ──────────────────────────────────────────────── */}
      {breadcrumb.length > 0 && (
        <View style={[styles.breadcrumb, { top: topInset }]} pointerEvents="box-none">
          <View style={styles.breadcrumbInner} pointerEvents="auto">
            <TouchableOpacity
              onPress={() => { setFocusedId(null); Haptics.selectionAsync(); }}
              style={styles.breadcrumbHome}
            >
              <Feather name="home" size={14} color="#6b7280" />
            </TouchableOpacity>
            {hasEllipsis && (
              <>
                <Feather name="chevron-right" size={12} color="#d1d5db" style={styles.chevron} />
                <TouchableOpacity
                  onPress={() => {
                    if (ellipsisTargetId == null) return;
                    setFocusedId(ellipsisTargetId);
                    Haptics.selectionAsync();
                  }}
                  style={styles.crumbBtn}
                >
                  <Text style={styles.crumbEllipsis}>…</Text>
                </TouchableOpacity>
              </>
            )}
            {breadcrumb.map((crumb, i) => (
              <React.Fragment key={crumb.id}>
                <Feather name="chevron-right" size={12} color="#d1d5db" style={styles.chevron} />
                <TouchableOpacity
                  onPress={() => { setFocusedId(crumb.id); Haptics.selectionAsync(); }}
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
          <Text style={styles.hint}>tap to focus · hold to add child · pinch to zoom</Text>
        </View>
      )}

      {/* ── Toolbar — hidden while Add panel is open ─────────────────────── */}
      {!showAdd && (
        <View style={[styles.toolbar, { bottom: bottomInset + 16 }]} pointerEvents="box-none">
          {editMode ? (
            <View style={styles.toolbarRow} pointerEvents="auto">
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
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => { importMap(); Haptics.selectionAsync(); }}
              >
                <Feather name="upload" size={20} color="#6b7280" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => { exportMap(); Haptics.selectionAsync(); }}
              >
                <Feather name="download" size={20} color="#6b7280" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => { forceSyncFromCloud(); Haptics.selectionAsync(); }}
              >
                <Feather name="refresh-cw" size={20} color="#6b7280" />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.pill, styles.pillEdit]} onPress={enterEdit}>
                <Feather name="edit-2" size={14} color="#6b7280" />
                <Text style={[styles.pillText, { color: '#6b7280' }]}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pill, styles.pillAdd]}
                onPress={() => {
                  setAddParentId(null);
                  setShowAdd(true);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <Feather name="plus" size={16} color="#fff" />
                <Text style={[styles.pillText, { color: '#fff' }]}>Add bubble</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* ── Cloud save-failed toast ─────────────────────────────────────── */}
      {!cloudSaveOk && (
        <View style={[styles.cloudFailToast, { bottom: bottomInset + 76 }]} pointerEvents="none">
          <Text style={styles.cloudFailText}>
            ☁ Couldn't reach the server — saved locally. Make any edit to retry.
          </Text>
        </View>
      )}

      {/* ── Edit panel ──────────────────────────────────────────────────── */}
      {editMode && editSelection && (
        <EditBubblePanel bubbleId={editSelection} focusLabel={focusEditLabel} />
      )}

      {/* ── Add panel ───────────────────────────────────────────────────── */}
      {showAdd && (
        <AddBubblePanel
          onClose={closeAddPanel}
          initialParentId={addParentId}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  breadcrumb: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', zIndex: 50,
  },
  breadcrumbInner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 20, paddingHorizontal: 12, height: 36,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 4, maxWidth: '90%',
  },
  breadcrumbHome: { paddingHorizontal: 4, height: 36, justifyContent: 'center' },
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
  crumbEllipsis: {
    fontSize: 14, fontFamily: 'Inter_400Regular',
    color: '#9ca3af', paddingHorizontal: 2,
  },
  crumbTextActive: { color: '#374151', fontFamily: 'Inter_500Medium' },
  hintWrap: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', zIndex: 10,
  },
  hint: {
    fontSize: 11, fontFamily: 'Inter_400Regular',
    color: '#9ca3af', letterSpacing: 0.8, opacity: 0.7,
  },
  toolbar: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', zIndex: 50,
  },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, height: 44, borderRadius: 22,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10, shadowRadius: 6, elevation: 4,
  },
  pillText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  pillEdit: { backgroundColor: 'rgba(255,255,255,0.92)' },
  pillAdd:  { backgroundColor: 'rgba(90,80,110,0.85)' },
  pillDone: { backgroundColor: 'rgba(80,110,90,0.85)' },
  pillDanger: { backgroundColor: 'rgba(255,255,255,0.92)' },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.88)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
  },
  cloudFailToast: {
    position: 'absolute', left: 16, right: 16,
    alignItems: 'center', zIndex: 60,
  },
  cloudFailText: {
    fontSize: 12, fontFamily: 'Inter_400Regular',
    color: 'hsl(12,55%,40%)', textAlign: 'center',
    backgroundColor: 'rgba(255,248,245,0.94)',
    borderRadius: 16, paddingHorizontal: 16, paddingVertical: 9,
    overflow: 'hidden',
    shadowColor: '#c85040', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
});
