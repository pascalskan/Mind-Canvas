import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useBubbles } from '@/context/BubbleContext';
import { useSlideIn } from '@/lib/animation';

/** "3 minutes ago", "just now" — friendlier than a raw timestamp in a prompt. */
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
 * Shown when the 30 s check finds a save on the server that this device has
 * not seen. Deliberately a choice rather than an action: the remote save is
 * never applied unless the user says so, because the alternative is somebody's
 * canvas rearranging itself mid-thought.
 */
export default function SaveAvailablePrompt() {
  const { pendingSave } = useBubbles();
  // The card is a SEPARATE component that only exists while there is a save to
  // offer, so its slide-in animation runs on a real mount — the same shape as
  // SettingsPanel, which is mounted conditionally by its parent.
  //
  // Doing the animation in this always-mounted component instead fired the
  // spring once at app launch, against a value no view was attached to yet.
  // The Animated.Value was left at its initial -140 and every later prompt
  // rendered 140px above where it belonged: visible at the top of the screen,
  // but with "Open recent save" pushed off it entirely. The prompt looked
  // fine and could not be answered — reloading was the only way past it.
  if (!pendingSave) return null;
  return <PromptCard />;
}

function PromptCard() {
  const { pendingSave, acceptPendingSave, dismissPendingSave } = useBubbles();
  const insets = useSafeAreaInsets();

  const slideY = useSlideIn(-140);

  // The parent only renders this while a save is pending, but the context can
  // clear between its render and ours.
  if (!pendingSave) return null;

  const savedAt = pendingSave.meta.savedAt;
  const from = pendingSave.meta.savedBy === 'web' ? 'the website' : 'another device';
  const when = savedAt ? relativeTime(savedAt) : 'recently';
  const named = pendingSave.meta.name?.trim();

  return (
    <Animated.View
      style={[styles.wrap, { top: insets.top + 8, transform: [{ translateY: slideY }] }]}
      pointerEvents="box-none"
    >
      <View style={styles.card}>
        <Text style={styles.title}>Sync to app</Text>
        <Text style={styles.body}>
          {named
            ? `“${named}” was saved on ${from} ${when}.`
            : `A newer canvas was saved on ${from} ${when}.`}
          {' '}Open it here, or keep working on what you have?
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => { dismissPendingSave(); Haptics.selectionAsync(); }}
          >
            <Text style={styles.secondaryText}>Keep current canvas</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              acceptPendingSave();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }}
          >
            <Text style={styles.primaryText}>Open recent save</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footnote}>
          Keeping the current canvas won&apos;t delete the save — you can still open it later by saving over it or reopening the app.
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', left: 12, right: 12, zIndex: 200,
    alignItems: 'center',
  },
  card: {
    width: '100%', maxWidth: 460,
    backgroundColor: 'rgba(252,252,254,0.98)',
    borderRadius: 18, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14, shadowRadius: 16, elevation: 10,
  },
  title: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold',
    color: '#8b7fb8', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6,
  },
  body: {
    fontSize: 14, fontFamily: 'Inter_400Regular',
    color: '#374151', lineHeight: 20,
  },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  secondaryBtn: {
    flex: 1, height: 42, borderRadius: 21,
    borderWidth: 1.5, borderColor: '#e5e7eb',
    alignItems: 'center', justifyContent: 'center',
  },
  secondaryText: { fontSize: 13.5, fontFamily: 'Inter_400Regular', color: '#6b7280' },
  primaryBtn: {
    flex: 1, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(90,80,110,0.92)',
    alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { fontSize: 13.5, fontFamily: 'Inter_500Medium', color: '#fff' },
  footnote: {
    fontSize: 11.5, fontFamily: 'Inter_400Regular',
    color: '#9ca3af', marginTop: 10, lineHeight: 16,
  },
});
