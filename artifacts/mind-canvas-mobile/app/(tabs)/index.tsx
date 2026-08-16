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
import SettingsPanel from '@/components/SettingsPanel';
import SaveAvailablePrompt from '@/components/SaveAvailablePrompt';

export default function MainScreen() {
  const {
    bubbles, focusedId, editMode, editSelection,
    byId, setFocusedId, setEditSelection,
    enterEditMode, cancelEditMode, saveEditMode,
    cloudSaveOk, saveError, hasUnsavedChanges,
  } = useBubbles();

  const insets = useSafeAreaInsets();
  const [showAdd, setShowAdd]           = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [addParentId, setAddParentId]   = useState<string | null>(null);
  // Hide-text view: labels, breadcrumb and hint leave the screen so the map
  // can be read as pure shape, colour and arrangement. A toggle rather than
  // the desktop's hold-Tab, because there is no key to hold — the same button
  // that turns it on is the one that turns it off.
  const [textHidden, setTextHidden]     = useState(false);
  const [focusEditLabel, setFocusEditLabel] = useState(false);
  // Tracks whether the current focusEditLabel=true was consumed at mount time,
  // so a subsequent editSelection change (single-tap in edit mode) won't
  // unexpectedly auto-focus the next panel.
  const doubleTapPendingRef = useRef(false);

  // Editing is about the words, so entering edit mode by any route — the
  // toolbar button or a double-tap on a bubble — puts the text back rather
  // than dropping the user into a rename field on a canvas with no labels.
  useEffect(() => {
    if (editMode) setTextHidden(false);
  }, [editMode]);

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
    enterEditMode();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };
  const cancelEdit = () => {
    // cancelEditMode reverts every mutation made since enterEditMode (see
    // M4) — Cancel used to be identical to Done, silently keeping edits.
    cancelEditMode(); setFocusEditLabel(false); Haptics.selectionAsync();
  };
  const doneEdit = () => {
    saveEditMode(); setFocusEditLabel(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // ── Long-press: add child of tapped bubble ─────────────────────────────────

  const handleLongPressAddChild = useCallback((parentId: string) => {
    setAddParentId(parentId);
    setShowAdd(true);
  }, []);

  const handleDoubleTapBubble = useCallback((id: string) => {
    doubleTapPendingRef.current = true;
    enterEditMode();
    setEditSelection(id);
    setFocusEditLabel(true);
  }, [enterEditMode, setEditSelection]);

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
        hideText={textHidden}
      />

      {/* ── Settings (top-left) ─────────────────────────────────────────── */}
      {!showAdd && !showSettings && !editMode && (
        <View style={[styles.settingsWrap, { top: topInset }]} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => { setShowSettings(true); Haptics.selectionAsync(); }}
            accessibilityLabel="Settings"
          >
            <Feather name="settings" size={19} color="#6b7280" />
            {/* Unsaved-changes dot. Under the manual-save model nothing reaches
                the cloud until the user asks, so the app owes them a standing,
                glanceable answer to "is my work published?" — otherwise the
                only honest signal is buried inside the panel they have to open. */}
            {hasUnsavedChanges && (
              <View style={styles.unsavedDot} pointerEvents="none" />
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* ── Breadcrumb bar ──────────────────────────────────────────────── */}
      {/* The crumbs are bubble labels, so they go with the rest of the text. */}
      {breadcrumb.length > 0 && !textHidden && (
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
      {!focusedId && !editMode && !showAdd && !textHidden && (
        <View style={[styles.hintWrap, { top: topInset + 10 }]} pointerEvents="none">
          <Text style={styles.hint}>tap to focus · hold to add child · pinch to zoom</Text>
        </View>
      )}

      {/* ── Toolbar — hidden while any sheet is open ─────────────────────────
          Settings has to hide it too, not just Add. The sheet slides up from
          the bottom into exactly the space these buttons occupy, so Edit and
          Add bubble sat on top of it, covering Erase canvas and taking the
          taps meant for it. */}
      {!showAdd && !showSettings && (
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
            // Import/Export/Sync used to sit here. Import and Export moved into
            // Settings (they are occasional, deliberate actions), and Sync is
            // gone entirely — saving is now explicit and the app offers a newer
            // save via SaveAvailablePrompt instead of a button you have to know
            // to press.
            <View style={styles.toolbarRow} pointerEvents="auto">
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

      {/* ── Hide-text toggle (bottom-left) ───────────────────────────────
          Sits on the toolbar's baseline, opposite the centred pills, and hides
          alongside them whenever a sheet slides up into that space. Not shown
          in edit mode: editing is about the words. */}
      {!showAdd && !showSettings && !editMode && (
        <View style={[styles.textToggleWrap, { bottom: bottomInset + 16 }]} pointerEvents="box-none">
          <TouchableOpacity
            style={[styles.iconBtn, textHidden && styles.iconBtnActive]}
            onPress={() => { setTextHidden(v => !v); Haptics.selectionAsync(); }}
            accessibilityRole="button"
            accessibilityLabel={textHidden ? 'Show text' : 'Hide text'}
          >
            <Feather name="type" size={18} color={textHidden ? '#fff' : '#6b7280'} />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Cloud save-failed toast ─────────────────────────────────────────
          Clears on the next successful save. The old copy told the user to
          "make any edit to retry" — true when every edit auto-pushed, and
          actively misleading now that editing never touches the network. The
          only retry is Save canvas, so this is a button that opens Settings. */}
      {!cloudSaveOk && !showSettings && (
        <View style={[styles.cloudFailToast, { bottom: bottomInset + 76 }]} pointerEvents="box-none">
          <TouchableOpacity
            onPress={() => { setShowSettings(true); Haptics.selectionAsync(); }}
            accessibilityRole="button"
            accessibilityLabel="Saving failed — open settings to try again"
          >
            <Text style={styles.cloudFailText}>
              {saveError === 'not-configured'
                ? '☁ No server configured — this canvas can’t be published. Tap for options.'
                : saveError === 'rejected'
                  ? '☁ The server refused the save — your work is safe here. Tap to try again.'
                  : '☁ Couldn’t reach the server — your work is safe here. Tap to try again.'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Edit panel ──────────────────────────────────────────────────── */}
      {/* key={editSelection} forces a remount on every selection change — the
          panel seeds label/color/scale from props via useState (initial value
          only), so without a key React reuses the instance across selections
          and both the displayed values AND a rename-on-blur silently apply to
          the wrong bubble. */}
      {editMode && editSelection && (
        <EditBubblePanel key={editSelection} bubbleId={editSelection} focusLabel={focusEditLabel} />
      )}

      {/* ── Add panel ───────────────────────────────────────────────────── */}
      {showAdd && (
        <AddBubblePanel
          onClose={closeAddPanel}
          initialParentId={addParentId}
        />
      )}

      {/* ── Settings sheet ──────────────────────────────────────────────── */}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {/* ── Newer-save prompt (renders nothing when there is none) ───────── */}
      <SaveAvailablePrompt />
    </View>
  );
}

const styles = StyleSheet.create({
  breadcrumb: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', zIndex: 50,
    // Keep the bar clear of the Settings button (44pt wide at left: 12) and of
    // the symmetric space on the right. Without this the centred bar — up to
    // 90% of the screen — ran underneath the button on narrow devices, so a tap
    // meant for the first crumb opened Settings instead. Settings still wins on
    // zIndex, which is what made the collision silent rather than visible.
    paddingHorizontal: 64,
  },
  breadcrumbInner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 20, paddingHorizontal: 12, height: 36,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 4, maxWidth: '100%',
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
  settingsWrap: {
    position: 'absolute', left: 12, zIndex: 55,
  },
  // Below the toolbar (zIndex 50) on purpose. On a phone narrow enough for the
  // centred pills to reach this corner, the pills draw over this button and
  // take the taps in the overlap — so what you can see is always what you hit,
  // and the more important control wins.
  textToggleWrap: {
    position: 'absolute', left: 12, zIndex: 45,
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
  /** On = the canvas is stripped of text, matching the Add pill's weight. */
  iconBtnActive: { backgroundColor: 'rgba(90,80,110,0.85)' },
  unsavedDot: {
    position: 'absolute', top: 8, right: 8,
    width: 9, height: 9, borderRadius: 4.5,
    backgroundColor: 'hsl(35,85%,55%)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.95)',
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
