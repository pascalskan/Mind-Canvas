import { motion } from 'framer-motion';

/**
 * How long each beat of the completion animation runs.
 *
 * Exported because MindCanvas drives the same timeline: the bubble is not
 * archived until the pop has finished, so the animation and the mutation must
 * agree on when that is. Tune here and both follow.
 */
export const COMPLETE_FADE_MS = 320;   // the glass empties out
export const COMPLETE_FILL_MS = 760;   // colour rises to the brim
export const COMPLETE_POP_MS  = 300;   // and it goes
export const COMPLETE_TOTAL_MS = COMPLETE_FADE_MS + COMPLETE_FILL_MS + COMPLETE_POP_MS;

interface Props {
  label: string;
  color: string;
  /** How many bubbles go with it — the whole subtree, not counting itself. */
  descendants: number;
  /** Notes carried by the bubble and everything under it. */
  notes: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The confirmation shown before a bubble is completed.
 *
 * A styled prompt rather than window.confirm because the thing that needs
 * saying is a COUNT — how much disappears from the canvas along with the
 * bubble. A native dialog cannot show the colour of what is about to go, and
 * the number is the whole point of asking.
 */
export default function CompletionPrompt({
  label, color, descendants, notes, onConfirm, onCancel,
}: Props) {
  const total = descendants + 1;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="absolute inset-0 z-[60]"
        style={{ background: 'rgba(28,30,32,.28)', backdropFilter: 'blur(2px)' }}
        onPointerDown={e => { e.stopPropagation(); onCancel(); }}
      />

      <motion.div
        initial={{ opacity: 0, y: 12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 24 }}
        className="absolute left-1/2 top-1/2 z-[61] pointer-events-auto"
        style={{ transform: 'translate(-50%,-50%)', width: 'min(380px, calc(100vw - 48px))' }}
        onPointerDown={e => e.stopPropagation()}
        onPointerUp={e => e.stopPropagation()}
      >
        <div className="p-6"
          style={{
            background: 'rgba(255,255,255,.96)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 20,
            boxShadow: '0 12px 48px rgba(0,0,0,.16),inset 0 0 0 1px rgba(255,255,255,.9)',
          }}>

          <div className="flex items-center gap-2.5 mb-3">
            <span style={{
              width: 12, height: 12, borderRadius: '50%',
              background: color, flexShrink: 0,
            }} />
            <p className="text-[15px] text-gray-700 font-light truncate">{label}</p>
          </div>

          <p className="text-[13px] text-gray-500 font-light leading-relaxed mb-1">
            Completing this bubble moves it to the archive, along with
            everything inside it.
          </p>

          <ul className="text-[13px] text-gray-600 font-light leading-relaxed my-3 pl-1">
            <li>
              <span style={{ color: '#3f3f48' }}>{total}</span>
              {total === 1 ? ' bubble' : ' bubbles'}
              {descendants > 0 && ` — this one and ${descendants} inside it`}
            </li>
            {notes > 0 && (
              <li>
                <span style={{ color: '#3f3f48' }}>{notes}</span>
                {notes === 1 ? ' note' : ' notes'} written on them
              </li>
            )}
          </ul>

          <p className="text-[12.5px] text-gray-400 font-light leading-relaxed mb-5">
            They leave the canvas but nothing is deleted — Show archived brings
            them back into view at any time.
          </p>

          <div className="flex items-center justify-end gap-2">
            <button
              className="text-[13px] font-light text-gray-500 px-4 py-2 rounded-full"
              style={{ background: 'rgba(0,0,0,.05)' }}
              onClick={onCancel}>
              Cancel
            </button>
            <button
              className="text-[13px] font-light text-white px-4 py-2 rounded-full"
              style={{ background: 'rgba(90,80,110,.92)' }}
              onClick={onConfirm}>
              Complete bubble
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
