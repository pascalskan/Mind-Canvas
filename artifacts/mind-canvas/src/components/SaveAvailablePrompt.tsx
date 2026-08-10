import { motion } from 'framer-motion';
import type { SavedBy } from '../persistence';

interface Props {
  savedAt?: number;
  savedBy?: SavedBy;
  name?: string;
  onAccept: () => void;
  onDismiss: () => void;
}

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
 * Shown when the 30 s check finds a save on the server that this browser has
 * not seen. Deliberately a choice rather than an action: the remote save is
 * never applied unless the user says so, because the alternative is somebody's
 * canvas rearranging itself mid-thought.
 */
export default function SaveAvailablePrompt({
  savedAt, savedBy, name, onAccept, onDismiss,
}: Props) {
  const from = savedBy === 'mobile' ? 'the app' : 'another device';
  const when = savedAt ? relativeTime(savedAt) : 'recently';
  const named = name?.trim();

  return (
    <motion.div
      initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className="absolute top-6 left-1/2 -translate-x-1/2 z-[60] pointer-events-auto"
      style={{ width: 'min(440px, calc(100vw - 48px))' }}
      onPointerDown={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}>
      <div className="p-4"
        style={{
          background: 'rgba(255,255,255,.96)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 16,
          boxShadow: '0 8px 40px rgba(0,0,0,.14),inset 0 0 0 1px rgba(255,255,255,.9)',
        }}>
        <p className="text-xs uppercase tracking-widest font-light mb-1.5"
          style={{ color: 'hsl(260,35%,58%)' }}>
          Sync to website
        </p>
        <p className="text-sm font-light text-gray-600 leading-relaxed">
          {named
            ? <>&ldquo;{named}&rdquo; was saved on {from} {when}.</>
            : <>A newer canvas was saved on {from} {when}.</>}
          {' '}Open it here, or keep working on what you have?
        </p>

        <div className="flex gap-2 mt-3.5">
          <button onClick={onDismiss}
            className="flex-1 text-sm font-light text-gray-600 rounded-full"
            style={{ border: '1px solid #e5e7eb', minHeight: 42 }}>
            Keep current canvas
          </button>
          <button onClick={onAccept}
            className="flex-1 text-sm font-light text-white rounded-full"
            style={{ background: 'rgba(90,80,110,.92)', minHeight: 42 }}>
            Open recent save
          </button>
        </div>

        <p className="text-xs font-light text-gray-400 mt-2.5 leading-relaxed">
          Keeping the current canvas won&apos;t delete the save — you can still open it later by reloading, or replace it by saving over it.
        </p>
      </div>
    </motion.div>
  );
}
