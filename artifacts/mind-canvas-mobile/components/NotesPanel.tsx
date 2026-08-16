import React, { useEffect, useState } from 'react';
import {
  Alert, Animated, Platform, Pressable, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useBubbles } from '@/context/BubbleContext';
import { useSlideIn, slideOut } from '@/lib/animation';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import type { BubbleNote } from '@/lib/bubbleTypes';

/**
 * Generous enough that no real note hits it, small enough that a runaway paste
 * cannot push the whole canvas past the storage quota — every note travels
 * inside the same payload as the map itself.
 */
export const NOTE_MAX_LENGTH = 2000;

interface Props {
  /**
   * The bubble these notes belong to. Passed in rather than read from context
   * so the sheet stays bound to the bubble it was opened for even if focus
   * moves underneath it.
   */
  bubbleId: string;
  onClose: () => void;
}

/** "3 minutes ago", "just now" — matches the wording used in Settings. */
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

function blankNote(): BubbleNote {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    text: '',
    createdAt: Date.now(),
  };
}

/** Comparable shape for the dirty check — id and text are all that can change. */
function shapeOf(notes: BubbleNote[]): string {
  return JSON.stringify(notes.map(n => [n.id, n.text]));
}

/**
 * Notes sheet.
 *
 * A bottom sheet rather than a modal or a popover: it is the idiom the rest of
 * this app already uses for anything with a text field (Settings, Add bubble),
 * it puts the controls within thumb reach, and it leaves the canvas visible
 * above so the bubble being annotated stays in view.
 *
 * Opens in VIEW mode every time, whether or not the bubble has notes — reading
 * is the common case, and landing straight in an editor makes accidental edits
 * the default. One button moves to editing: "Add notes" when the bubble has
 * none, "Edit notes" when it does.
 *
 * Editing works on a DRAFT. Nothing touches the canvas until Save, so backing
 * out — Cancel, the close button, tapping away — leaves the bubble exactly as
 * it was, and each of those routes asks first when there is work to lose.
 *
 * The header names the bubble in its own colour, because the one rule of this
 * feature is that notes belong to exactly one bubble.
 */
export default function NotesPanel({ bubbleId, onClose }: Props) {
  const { byId, setBubbleNotes } = useBubbles();
  const insets = useSafeAreaInsets();

  const bubble = byId[bubbleId];
  const notes  = bubble?.notes ?? [];

  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<BubbleNote[]>([]);

  const slideY = useSlideIn(460);

  // Blank entries are scaffolding, not content: an untouched one the user never
  // filled in must not become a note on Save, and must not count as a change.
  const cleaned = draft.map(n => ({ ...n, text: n.text.trim() })).filter(n => n.text.length > 0);
  const dirty   = editing && shapeOf(cleaned) !== shapeOf(notes);

  // The bubble can vanish from under an open sheet — deleted on another device
  // and pulled in by a save, or erased by Clear. Rendering on would crash on
  // `bubble.label`, so close instead. In an effect, not inline: calling onClose
  // during render sets state in the parent mid-render.
  useEffect(() => {
    if (!bubble) onClose();
  }, [bubble, onClose]);

  if (!bubble) return null;

  const close = () => slideOut(slideY, 460, onClose);

  /** Every exit that would destroy a draft comes through here. */
  const confirmDiscard = (then: () => void) => {
    if (!dirty) { then(); return; }
    Alert.alert(
      'Discard changes?',
      'Your unsaved note changes will be lost.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: then },
      ],
    );
  };

  const enterEditing = () => {
    // Starting with one empty field when there is nothing yet means the button
    // lands the user somewhere they can immediately type.
    setDraft(notes.length > 0 ? notes.map(n => ({ ...n })) : [blankNote()]);
    setEditing(true);
    Haptics.selectionAsync();
  };

  const cancelEditing = () => confirmDiscard(() => {
    setEditing(false);
    setDraft([]);
  });

  const save = () => {
    setBubbleNotes(bubbleId, cleaned);
    setEditing(false);
    setDraft([]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const setText = (id: string, text: string) =>
    setDraft(d => d.map(n => (n.id === id ? { ...n, text } : n)));

  const removeAt = (id: string) => {
    Haptics.selectionAsync();
    setDraft(d => d.filter(n => n.id !== id));
  };

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const heading   = editing ? (notes.length > 0 ? 'Edit notes' : 'Add notes') : 'Notes';

  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => confirmDiscard(close)} />

      <Animated.View
        style={[styles.panel, { paddingBottom: bottomPad + 12, transform: [{ translateY: slideY }] }]}
      >
        <View style={styles.handle} />

        <View style={styles.titleRow}>
          <Text style={styles.title}>{heading}</Text>
          <TouchableOpacity
            onPress={() => confirmDiscard(close)}
            style={styles.closeBtn}
            accessibilityLabel="Close notes"
          >
            <Feather name="x" size={18} color="#9ca3af" />
          </TouchableOpacity>
        </View>

        {/* Whose notes these are. */}
        <View style={styles.ownerRow}>
          <View style={[styles.ownerDot, { backgroundColor: bubble.color }]} />
          <Text style={styles.ownerLabel} numberOfLines={1}>{bubble.label}</Text>
          <Text style={styles.ownerCount}>
            {notes.length === 0 ? 'no notes' : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
          </Text>
        </View>

        <KeyboardAwareScrollViewCompat
          style={styles.list}
          contentContainerStyle={styles.listContent}
        >
          {editing ? (
            <>
              {draft.map(note => (
                <View key={note.id} style={styles.noteEditing}>
                  <TextInput
                    style={styles.noteInput}
                    value={note.text}
                    onChangeText={t => setText(note.id, t)}
                    multiline
                    maxLength={NOTE_MAX_LENGTH}
                    placeholder="Write a note…"
                    placeholderTextColor="#c4c4cc"
                  />
                  <TouchableOpacity
                    onPress={() => removeAt(note.id)}
                    style={styles.removeBtn}
                    accessibilityLabel="Remove note"
                  >
                    <Feather name="trash-2" size={14} color="#c98b84" />
                    <Text style={styles.removeText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <TouchableOpacity
                onPress={() => setDraft(d => [...d, blankNote()])}
                style={styles.addAnother}
              >
                <Feather name="plus" size={15} color="#6b7280" />
                <Text style={styles.addAnotherText}>Add another note</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {notes.length === 0 ? (
                <Text style={styles.empty}>
                  Nothing here yet. Notes you add stay with this bubble — its parent and
                  its children each keep their own.
                </Text>
              ) : notes.map(note => (
                <View key={note.id} style={styles.note}>
                  <Text style={styles.noteText}>{note.text}</Text>
                  <Text style={styles.noteMeta}>{relativeTime(note.createdAt)}</Text>
                </View>
              ))}
            </>
          )}
        </KeyboardAwareScrollViewCompat>

        {/* Footer. In editing, this bar holds the only write to the canvas. */}
        <View style={styles.footer}>
          {editing ? (
            <View style={styles.footerRow}>
              <TouchableOpacity onPress={cancelEditing} style={[styles.footerBtn, styles.footerBtnGhost]}>
                <Text style={styles.footerBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={save}
                disabled={!dirty}
                style={[styles.footerBtn, styles.footerBtnPrimary, !dirty && styles.footerBtnDisabled]}
              >
                <Feather name="check" size={15} color="#fff" />
                <Text style={styles.footerBtnPrimaryText}>Save notes</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={enterEditing} style={[styles.footerBtn, styles.footerBtnPrimary, styles.footerBtnWide]}>
              <Feather name={notes.length === 0 ? 'plus' : 'edit-2'} size={15} color="#fff" />
              <Text style={styles.footerBtnPrimaryText}>
                {notes.length === 0 ? 'Add notes' : 'Edit notes'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    maxHeight: '78%',
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
    justifyContent: 'space-between', marginBottom: 10,
  },
  title: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold',
    color: '#999', letterSpacing: 1.5, textTransform: 'uppercase',
  },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  ownerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#ececed',
  },
  ownerDot: { width: 10, height: 10, borderRadius: 5 },
  ownerLabel: {
    flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: '#374151',
  },
  ownerCount: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9ca3af' },

  list: { marginTop: 4 },
  listContent: { paddingVertical: 10, gap: 10 },
  empty: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: '#9ca3af',
    lineHeight: 19, paddingVertical: 14,
  },

  note: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: '#ececf0',
  },
  noteText: {
    fontSize: 14, fontFamily: 'Inter_400Regular', color: '#374151', lineHeight: 20,
  },
  noteMeta: {
    fontSize: 11, fontFamily: 'Inter_400Regular', color: '#b0b0b8', marginTop: 8,
  },

  noteEditing: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 14, padding: 10,
    borderWidth: 1, borderColor: '#e3e3ea',
  },
  noteInput: {
    fontSize: 14, fontFamily: 'Inter_400Regular', color: '#1a1a1a',
    lineHeight: 20, minHeight: 64, textAlignVertical: 'top',
  },
  removeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-end', paddingHorizontal: 8, paddingVertical: 6,
  },
  removeText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#c98b84' },

  addAnother: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.035)',
  },
  addAnotherText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#6b7280' },

  footer: { paddingTop: 10, borderTopWidth: 1, borderTopColor: '#ececed' },
  footerRow: { flexDirection: 'row', gap: 8 },
  footerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, height: 46, borderRadius: 23,
  },
  footerBtnWide: { flex: 0, width: '100%' },
  footerBtnGhost: { backgroundColor: 'rgba(0,0,0,0.05)' },
  footerBtnGhostText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#6b7280' },
  footerBtnPrimary: { backgroundColor: 'rgba(90,80,110,0.92)' },
  footerBtnPrimaryText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#fff' },
  footerBtnDisabled: { opacity: 0.4 },
});
