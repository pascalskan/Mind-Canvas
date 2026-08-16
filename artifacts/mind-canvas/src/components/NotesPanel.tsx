import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { BubbleData, BubbleNote } from '../persistence';

/**
 * Generous enough that no real note hits it, small enough that a runaway paste
 * cannot push the whole canvas past the storage quota — every note travels
 * inside the same payload as the map itself.
 */
export const NOTE_MAX_LENGTH = 2000;

/** Asked before throwing away an unsaved draft, from every route that can. */
export const DISCARD_PROMPT = 'Discard your unsaved note changes?';

interface Props {
  bubble: BubbleData;
  /** Commits the whole set. Only ever called from Save. */
  onSave: (bubbleId: string, notes: BubbleNote[]) => void;
  /** Lets the canvas know a close would destroy work — see the "n" handler. */
  onDirtyChange?: (dirty: boolean) => void;
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

const label = 'text-[11px] uppercase tracking-[.12em] text-gray-400 font-medium';

/**
 * Notes panel.
 *
 * Opens in VIEW mode every time, whether or not the bubble has notes — reading
 * is the common case, and landing straight in an editor makes accidental edits
 * the default. One button moves to editing: "Add notes" when the bubble has
 * none, "Edit notes" when it does.
 *
 * Editing works on a DRAFT. Nothing touches the canvas until Save, so backing
 * out — Cancel, Escape, the close button, clicking away — leaves the bubble
 * exactly as it was. Every one of those routes asks first when there is work to
 * lose.
 *
 * Anchored above the notes button in the bottom-left rather than centred, so
 * the canvas stays readable beside it and a note can be written while looking
 * at the bubble it describes.
 */
export default function NotesPanel({ bubble, onSave, onDirtyChange, onClose }: Props) {
  const notes = bubble.notes ?? [];

  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<BubbleNote[]>([]);
  const firstFieldRef = useRef<HTMLTextAreaElement>(null);

  // Blank entries are scaffolding, not content: an untouched one the user never
  // filled in must not become a note on Save, and must not count as a change.
  const cleaned = draft.map(n => ({ ...n, text: n.text.trim() })).filter(n => n.text.length > 0);
  const dirty   = editing && shapeOf(cleaned) !== shapeOf(notes);

  // The "n" shortcut can close this panel from outside, so the canvas needs to
  // know when that would throw work away.
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  const enterEditing = () => {
    // Starting with one empty field when there is nothing yet means the button
    // lands the user somewhere they can immediately type.
    setDraft(notes.length > 0 ? notes.map(n => ({ ...n })) : [blankNote()]);
    setEditing(true);
    window.setTimeout(() => firstFieldRef.current?.focus(), 0);
  };

  const cancelEditing = () => {
    if (dirty && !window.confirm(DISCARD_PROMPT)) return;
    setEditing(false);
    setDraft([]);
  };

  const save = () => {
    onSave(bubble.id, cleaned);
    setEditing(false);
    setDraft([]);
  };

  const requestClose = () => {
    if (dirty && !window.confirm(DISCARD_PROMPT)) return;
    onClose();
  };

  const setText = (id: string, text: string) =>
    setDraft(d => d.map(n => (n.id === id ? { ...n, text } : n)));

  const removeAt = (id: string) => setDraft(d => d.filter(n => n.id !== id));

  return (
    <>
      {/* Click-away backdrop */}
      <div className="absolute inset-0 z-40"
        onPointerDown={e => { e.stopPropagation(); requestClose(); }} />

      <motion.div
        initial={{ opacity: 0, y: 12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="absolute bottom-6 left-6 z-50 pointer-events-auto"
        style={{ width: 'min(340px, calc(100vw - 48px))' }}
        onPointerDown={e => e.stopPropagation()}
        onPointerUp={e => e.stopPropagation()}
        onKeyDown={e => {
          // Escape belongs to this panel while it is open — otherwise it falls
          // through to the canvas and steps out of the focused bubble.
          if (e.key !== 'Escape') return;
          e.stopPropagation();
          if (editing) cancelEditing(); else onClose();
        }}>
        <div className="p-5 flex flex-col"
          style={{
            background: 'rgba(255,255,255,.94)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 18,
            boxShadow: '0 8px 40px rgba(0,0,0,.10),inset 0 0 0 1px rgba(255,255,255,.9)',
            maxHeight: 'min(560px, calc(100vh - 120px))',
          }}>

          <div className="flex items-center justify-between mb-3">
            <p className={label}>{editing ? (notes.length ? 'Edit notes' : 'Add notes') : 'Notes'}</p>
            <button className="text-gray-400 hover:text-gray-600 px-2 py-1 -mr-2 -my-1"
              aria-label="Close notes"
              onClick={requestClose}>✕</button>
          </div>

          {/* Whose notes these are. */}
          <div className="flex items-center gap-2 pb-3 mb-1"
            style={{ borderBottom: '1px solid rgba(0,0,0,.07)' }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: bubble.color, flexShrink: 0,
            }} />
            <span className="text-sm text-gray-700 font-light truncate flex-1">{bubble.label}</span>
            <span className="text-[11px] text-gray-400 font-light whitespace-nowrap">
              {notes.length === 0 ? 'no notes' : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {editing ? (
            /* ── Edit ──────────────────────────────────────────────────── */
            <>
              <div className="flex-1 overflow-y-auto -mx-1 px-1 py-2 flex flex-col gap-2">
                {draft.map((note, i) => (
                  <div key={note.id}
                    className="rounded-xl p-2.5"
                    style={{ background: 'rgba(255,255,255,.85)', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.07)' }}>
                    <textarea
                      ref={i === 0 ? firstFieldRef : undefined}
                      value={note.text}
                      maxLength={NOTE_MAX_LENGTH}
                      onChange={e => setText(note.id, e.target.value)}
                      rows={3}
                      placeholder="Write a note…"
                      className="w-full bg-transparent text-sm text-gray-700 font-light outline-none resize-none leading-relaxed"
                    />
                    <div className="flex justify-end">
                      <button
                        className="text-[11px] px-2 py-1 rounded-md font-light"
                        style={{ color: 'hsl(8,45%,55%)' }}
                        aria-label="Remove note"
                        onClick={() => removeAt(note.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  className="text-xs py-2 rounded-xl text-gray-500 font-light"
                  style={{ background: 'rgba(0,0,0,.035)' }}
                  onClick={() => setDraft(d => [...d, blankNote()])}>
                  + Add another note
                </button>
              </div>

              {/* Nothing above has touched the canvas — this is the only write. */}
              <div className="flex items-center justify-end gap-2 pt-3 mt-1"
                style={{ borderTop: '1px solid rgba(0,0,0,.07)' }}>
                <button
                  className="text-xs px-4 py-2 rounded-full text-gray-500 font-light"
                  style={{ background: 'rgba(0,0,0,.05)' }}
                  onClick={cancelEditing}>
                  Cancel
                </button>
                <button
                  className="text-xs px-4 py-2 rounded-full text-white font-light"
                  style={{ background: 'rgba(90,80,110,.9)', opacity: dirty ? 1 : .45,
                           cursor: dirty ? 'pointer' : 'default' }}
                  disabled={!dirty}
                  onClick={save}>
                  Save notes
                </button>
              </div>
            </>
          ) : (
            /* ── View (always the way in) ──────────────────────────────── */
            <>
              <div className="flex-1 overflow-y-auto -mx-1 px-1 py-2 flex flex-col gap-2">
                {notes.length === 0 ? (
                  <p className="text-xs text-gray-400 font-light leading-relaxed py-3">
                    Nothing here yet. Notes you add stay with this bubble — its parent
                    and its children each keep their own.
                  </p>
                ) : notes.map(note => (
                  <div key={note.id}
                    className="rounded-xl p-3"
                    style={{ background: 'rgba(255,255,255,.8)', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.06)' }}>
                    <p className="text-sm text-gray-700 font-light leading-relaxed whitespace-pre-wrap break-words">
                      {note.text}
                    </p>
                    <p className="text-[10.5px] text-gray-400 font-light mt-2">
                      {relativeTime(note.createdAt)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="pt-3 mt-1" style={{ borderTop: '1px solid rgba(0,0,0,.07)' }}>
                <button
                  className="w-full text-xs py-2.5 rounded-full text-white font-light"
                  style={{ background: 'rgba(90,80,110,.9)' }}
                  onClick={enterEditing}>
                  {notes.length === 0 ? 'Add notes' : 'Edit notes'}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </>
  );
}
