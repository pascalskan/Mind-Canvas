import { useState } from 'react';
import { motion } from 'framer-motion';
import type { SaveFailure } from '../hooks/useBubbleState';
import type { SaveMeta } from '../persistence';

interface Props {
  canvasName: string;
  onNameChange: (name: string) => void;
  saving: boolean;
  saveError: SaveFailure | null;
  hasUnsavedChanges: boolean;
  savedMeta: SaveMeta;
  onSave: () => Promise<{ ok: boolean }>;
  onExport: () => void;
  onImport: () => void;
  onClear: () => void;
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

/** What to tell the user after a failed save — each cause needs different advice. */
function saveErrorMessage(reason: SaveFailure): string {
  switch (reason) {
    case 'not-configured':
      return 'This build has no server configured, so the canvas cannot be published. '
           + 'Your work is safe here — use Export to keep a copy.';
    case 'unreachable':
      return "Couldn't reach the server. Your work is safe in this browser — try saving again in a moment.";
    case 'rejected':
      return 'The server refused the save. Your work is safe in this browser; if this persists, export a copy.';
  }
}

/**
 * Settings panel.
 *
 * Holds the actions that are deliberate rather than moment-to-moment: naming
 * the canvas, saving it to the shared map, import/export, and Clear. Clear in
 * particular lives here rather than on the main toolbar — it wipes the canvas
 * for every device once saved, which is not something that should sit one
 * stray click away from the drawing surface.
 */
export default function SettingsPanel({
  canvasName, onNameChange, saving, saveError, hasUnsavedChanges, savedMeta,
  onSave, onExport, onImport, onClear, onClose,
}: Props) {
  const [justSaved, setJustSaved] = useState(false);

  const handleSave = async () => {
    const result = await onSave();
    if (!result.ok) return;
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2500);
  };

  const label = 'text-xs uppercase tracking-widest font-light text-gray-400';

  return (
    <>
      {/* Click-away backdrop */}
      <div className="absolute inset-0 z-40"
        onPointerDown={e => { e.stopPropagation(); onClose(); }} />

      <motion.div
        initial={{ opacity: 0, x: -12, scale: .97 }} animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="absolute top-6 left-6 z-50 pointer-events-auto"
        style={{ width: 'min(320px, calc(100vw - 48px))' }}
        onPointerDown={e => e.stopPropagation()}
        onPointerUp={e => e.stopPropagation()}>
        <div className="p-5"
          style={{
            background: 'rgba(255,255,255,.94)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 18,
            boxShadow: '0 8px 40px rgba(0,0,0,.10),inset 0 0 0 1px rgba(255,255,255,.9)',
          }}>

          <div className="flex items-center justify-between mb-4">
            <p className={label}>Settings</p>
            <button className="text-gray-400 active:text-gray-600 px-2 py-1 -mr-2 -my-1"
              aria-label="Close settings"
              onClick={onClose}>✕</button>
          </div>

          {/* ── Canvas name ────────────────────────────────────────────── */}
          <p className={`${label} mb-2`}>Canvas name</p>
          <input
            value={canvasName}
            onChange={e => onNameChange(e.target.value)}
            placeholder="Untitled canvas"
            maxLength={60}
            className="w-full bg-transparent border-b border-gray-200 text-gray-700 font-light text-base outline-none py-2 mb-5 placeholder-gray-300"
          />

          {/* ── Save ───────────────────────────────────────────────────── */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 text-sm font-light text-white rounded-full transition-opacity disabled:opacity-50"
            style={{ background: 'rgba(90,80,110,.92)', minHeight: 46 }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>{justSaved ? '✓' : '☁'}</span>
            {saving ? 'Saving…' : justSaved ? 'Saved' : 'Save canvas'}
          </button>

          {saveError ? (
            <p className="text-xs font-light mt-2 leading-relaxed" style={{ color: 'hsl(12,55%,45%)' }}>
              {saveErrorMessage(saveError)}
            </p>
          ) : (
            <p className="text-xs font-light text-gray-400 mt-2 leading-relaxed">
              {hasUnsavedChanges
                ? 'You have changes that haven’t been saved yet.'
                : savedMeta.savedAt
                  ? `All changes saved — last saved ${relativeTime(savedMeta.savedAt)}${savedMeta.savedBy === 'mobile' ? ' on the app' : ''}.`
                  : 'Saving publishes this canvas so your app can pick it up.'}
            </p>
          )}

          {/* ── Transfer ───────────────────────────────────────────────── */}
          <p className={`${label} mt-6 mb-2`}>Canvas file</p>
          <div className="flex gap-2">
            <button onClick={onExport}
              className="flex-1 flex items-center justify-center gap-2 text-sm font-light text-gray-600 rounded-full"
              style={{ border: '1px solid #e5e7eb', minHeight: 44 }}>
              <span style={{ fontSize: 13, lineHeight: 1, opacity: .7 }}>↓</span> Export
            </button>
            <button onClick={onImport}
              className="flex-1 flex items-center justify-center gap-2 text-sm font-light text-gray-600 rounded-full"
              style={{ border: '1px solid #e5e7eb', minHeight: 44 }}>
              <span style={{ fontSize: 13, lineHeight: 1, opacity: .7 }}>↑</span> Import
            </button>
          </div>

          {/* ── Destructive ────────────────────────────────────────────── */}
          <button onClick={onClear}
            className="w-full flex items-center justify-center gap-2 text-sm font-light mt-5"
            style={{ color: 'hsl(0,55%,55%)', minHeight: 44 }}>
            <span style={{ fontSize: 13, lineHeight: 1 }}>↺</span> Erase canvas
          </button>
        </div>
      </motion.div>
    </>
  );
}
