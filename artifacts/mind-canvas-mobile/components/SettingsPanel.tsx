import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Platform, Pressable, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useBubbles, type SyncState } from '@/context/BubbleContext';

import type { SaveFailure } from '@/lib/persistence';
import { useSlideIn, slideOut } from '@/lib/animation';

interface Props {
  onClose: () => void;
}

/** "3 minutes ago", "just now" — friendlier than a raw timestamp. */
function relativeTime(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * One sentence on whether this device and the website are looking at the same
 * canvas. Under manual saving that is genuinely the user's problem to manage,
 * and until this line existed the app never volunteered the answer.
 */
function syncDescription(s: SyncState): string {
  switch (s.kind) {
    case 'unknown':
      return 'Checking whether the website has a newer version…';
    case 'unsaved':
      return 'The website is still on the last saved version. Save to send these changes to it.';
    case 'behind':
      return `The website saved a newer version ${relativeTime(s.remoteSavedAt)}. `
           + 'It will open here automatically once you finish editing.';
    case 'in-sync':
      return `In sync with the website as of ${relativeTime(s.lastChecked)}.`;
  }
}

/** What to tell the user after a failed save — each cause needs different advice. */
function saveErrorMessage(reason: SaveFailure): string {
  switch (reason) {
    case 'not-configured':
      return 'This build has no server configured, so the canvas cannot be published. '
           + 'Your work is safe on this device — use Export to keep a copy.';
    case 'unreachable':
      return "Couldn't reach the server. Your work is safe on this device — try saving again in a moment.";
    case 'rejected':
      return 'The server refused the save. Your work is safe on this device; if this persists, export a copy.';
  }
}

/**
 * Settings sheet.
 *
 * Holds the actions that are deliberate rather than moment-to-moment: naming
 * the canvas, saving it to the shared map, import/export, and Clear. Clear in
 * particular lives here rather than on the main toolbar — it wipes the canvas
 * for every device once saved, which is not something that should sit one
 * stray tap away from the drawing surface.
 */
export default function SettingsPanel({ onClose }: Props) {
  const {
    canvasName, setCanvasName, saving, saveCanvas, saveError,
    hasUnsavedChanges, savedMeta, syncState,
    exportMap, importMap, clearCanvas, noteInteraction,
  } = useBubbles();
  const insets = useSafeAreaInsets();

  const [justSaved, setJustSaved] = useState(false);

  const slideY = useSlideIn(400);
  const dismiss = () => slideOut(slideY, 400, onClose);

  // The field reads straight from context rather than mirroring it in local
  // state: Import runs from inside this panel and rewrites canvasName, and a
  // local copy would keep showing the OLD name over the newly imported map
  // until the sheet was closed and reopened. Writing on every keystroke also
  // means a save includes the name without needing the field to lose focus.

  const handleSave = async () => {
    // saveCanvas resolves with a RESULT OBJECT, not a boolean. `if (result)`
    // is always true, which would fire the success haptic and show "Saved"
    // even when the write failed — the exact false reassurance this panel
    // exists to prevent.
    const result = await saveCanvas();
    if (result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleClear = () => {
    Alert.alert(
      'Erase this canvas?',
      'Every bubble is removed and the canvas goes back to the starter map. '
      + 'This cannot be undone, and the next save replaces the shared canvas '
      + 'on your other device too. Export first if you want a copy.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase', style: 'destructive', onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            clearCanvas();
            dismiss();
          },
        },
      ],
    );
  };

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />

      <Animated.View
        style={[styles.panel, { paddingBottom: bottomPad + 16, transform: [{ translateY: slideY }] }]}
      >
        <View style={styles.handle} />

        <View style={styles.titleRow}>
          <Text style={styles.title}>Settings</Text>
          <TouchableOpacity onPress={dismiss} style={styles.closeBtn}>
            <Feather name="x" size={18} color="#9ca3af" />
          </TouchableOpacity>
        </View>

        {/* ── Canvas name ──────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Canvas name</Text>
        <TextInput
          style={styles.input}
          value={canvasName}
          onChangeText={t => { noteInteraction(); setCanvasName(t); }}
          placeholder="Untitled canvas"
          placeholderTextColor="#bbb"
          maxLength={60}
          returnKeyType="done"
        />

        {/* ── Save ─────────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnBusy]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Feather name={justSaved ? 'check' : 'upload-cloud'} size={16} color="#fff" />
          <Text style={styles.saveText}>
            {saving ? 'Saving…' : justSaved ? 'Saved' : 'Save canvas'}
          </Text>
        </TouchableOpacity>
        <Text style={[styles.saveHint, saveError != null && styles.saveHintError]}>
          {saveError != null
            ? saveErrorMessage(saveError)
            : hasUnsavedChanges
              ? 'You have changes that haven’t been saved yet.'
              : savedMeta.savedAt
                ? `All changes saved — last saved ${relativeTime(savedMeta.savedAt)}`
                  + `${savedMeta.savedBy === 'web' ? ' on the website' : ''}.`
                : 'Saving publishes this canvas so your website can pick it up.'}
        </Text>

        {/* ── Are the two devices on the same canvas? ─────────────────── */}
        <View style={styles.syncRow}>
          <View style={[styles.syncDot, {
            backgroundColor: syncState.kind === 'in-sync' ? 'hsl(150,45%,50%)'
              : syncState.kind === 'unknown' ? 'hsl(0,0%,70%)'
              : 'hsl(35,85%,55%)',
          }]} />
          <Text style={styles.syncText}>{syncDescription(syncState)}</Text>
        </View>

        {/* ── Transfer ─────────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, styles.sectionSpaced]}>Canvas file</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.rowBtn} onPress={() => { exportMap(); Haptics.selectionAsync(); }}>
            <Feather name="download" size={16} color="#6b7280" />
            <Text style={styles.rowBtnText}>Export</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.rowBtn} onPress={() => { importMap(); Haptics.selectionAsync(); }}>
            <Feather name="upload" size={16} color="#6b7280" />
            <Text style={styles.rowBtnText}>Import</Text>
          </TouchableOpacity>
        </View>

        {/* ── Destructive ──────────────────────────────────────────────── */}
        <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
          <Feather name="trash-2" size={15} color="#ef4444" />
          <Text style={styles.clearText}>Erase canvas</Text>
        </TouchableOpacity>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(252,252,254,0.98)',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 12,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#d1d5db', alignSelf: 'center', marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 14,
  },
  title: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold',
    color: '#999', letterSpacing: 1.5, textTransform: 'uppercase',
  },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: {
    fontSize: 11, fontFamily: 'Inter_500Medium',
    color: '#9ca3af', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8,
  },
  sectionSpaced: { marginTop: 20 },
  input: {
    fontSize: 17, fontFamily: 'Inter_400Regular', color: '#1a1a1a',
    borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
    paddingVertical: 8, marginBottom: 18,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: 24, backgroundColor: 'rgba(90,80,110,0.92)',
  },
  saveBtnBusy: { opacity: 0.6 },
  saveText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#fff' },
  saveHint: {
    fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9ca3af',
    marginTop: 8, lineHeight: 17,
  },
  saveHintError: { color: 'hsl(12,55%,45%)' },
  syncRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginTop: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)',
  },
  syncDot: { width: 7, height: 7, borderRadius: 3.5, marginTop: 5 },
  syncText: {
    flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular',
    color: '#6b7280', lineHeight: 17,
  },
  row: { flexDirection: 'row', gap: 10 },
  rowBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: '#e5e7eb',
  },
  rowBtnText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#6b7280' },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 44, marginTop: 22,
  },
  clearText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#ef4444' },
});
