import { motion } from 'framer-motion';

/**
 * A note taped to the canvas.
 *
 * Desktop only — the mobile app keeps its bottom sheet, which suits a thumb
 * and a small screen far better than anything pinned to a coordinate.
 *
 * The paper takes its colour from the bubble the note belongs to, so a fan of
 * notes around a bubble reads as that bubble's, not as loose UI. Two strips of
 * tape hold it on at a slight angle; both the angle and the tape are derived
 * from the note's id rather than random, so a note does not twitch every time
 * the canvas re-renders.
 */

export const NOTE_W = 190;
export const NOTE_H = 148;

/** Stable small integer from an id — the source of every per-note variation. */
function hashOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Degrees of lean. Enough to look placed by hand, not enough to look broken. */
export function tiltOf(id: string): number {
  return ((hashOf(id) % 900) / 100) - 4.5;
}

/** The paper: the bubble's hue washed most of the way out to white. */
function paperOf(color: string): string {
  return `color-mix(in srgb, ${color} 28%, #fffdf7)`;
}

/** A darker draw of the same hue, for the rule under the tape. */
function edgeOf(color: string): string {
  return `color-mix(in srgb, ${color} 45%, #ffffff)`;
}

interface TapeProps { side: 'left' | 'right'; }

/** One strip across a top corner, angled outward. */
function Tape({ side }: TapeProps) {
  const left = side === 'left';
  return (
    <span aria-hidden="true" style={{
      position: 'absolute',
      top: -11,
      [left ? 'left' : 'right']: -20,
      width: 78,
      height: 24,
      // Milky rather than clear, with its long edges catching the light — that
      // pair of highlights is what makes a rectangle read as tape at a glance.
      // Against pale paper a plain white strip vanishes. A faint cool cast plus
      // a defined edge on all four sides is what separates it from the note.
      background: 'rgba(248,249,252,.72)',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.9), 0 1px 3px rgba(40,40,50,.16)',
      // Torn off the roll, so the ends are never quite square.
      clipPath: 'polygon(4% 2%, 96% 0, 100% 98%, 0 100%)',
      transform: `rotate(${left ? -34 : 34}deg)`,
      backdropFilter: 'blur(1px) saturate(.85)',
      WebkitBackdropFilter: 'blur(1px) saturate(.85)',
    }} />
  );
}

interface Props {
  id: string;
  text: string;
  /** The owning bubble's colour — the note is a tint of it. */
  color: string;
  /** World-space centre. */
  x: number;
  y: number;
  /** Edit mode turns the paper into a field; view mode is inert. */
  editing?: boolean;
  onChange?: (text: string) => void;
  onRemove?: () => void;
  autoFocus?: boolean;
}

export default function StickyNote({
  id, text, color, x, y, editing, onChange, onRemove, autoFocus,
}: Props) {
  const tilt = tiltOf(id);

  return (
    <motion.div
      initial={{ opacity: 0, scale: .88 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: .9 }}
      transition={{ type: 'spring', stiffness: 240, damping: 20 }}
      className="absolute top-0 left-0"
      style={{
        x: x - NOTE_W / 2,
        y: y - NOTE_H / 2,
        width: NOTE_W,
        height: NOTE_H,
        rotate: tilt,
        // Above the bubble, below the canvas chrome.
        zIndex: 400,
      }}
      onPointerDown={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}
    >
      <div style={{
        position: 'relative',
        width: '100%', height: '100%',
        background: paperOf(color),
        boxShadow: '0 6px 18px rgba(40,40,50,.14), 0 1px 2px rgba(40,40,50,.10)',
        padding: '18px 15px 13px',
        display: 'flex', flexDirection: 'column',
      }}>
        <Tape side="left" />
        <Tape side="right" />

        {/* A single rule under the tape line, the way a memo pad prints one. */}
        <span aria-hidden="true" style={{
          position: 'absolute', left: 13, right: 13, top: 13,
          height: 1, background: edgeOf(color),
        }} />

        {editing ? (
          <>
            <textarea
              autoFocus={autoFocus}
              value={text}
              maxLength={2000}
              onChange={e => onChange?.(e.target.value)}
              placeholder="Write a note…"
              className="flex-1 w-full bg-transparent outline-none resize-none"
              style={{
                fontSize: 13, lineHeight: 1.5, color: '#44444c',
                fontWeight: 300, letterSpacing: '.01em',
              }}
            />
            <button
              onClick={onRemove}
              className="self-end"
              style={{
                fontSize: 11, fontWeight: 300, padding: '2px 6px',
                color: 'hsl(8,45%,45%)', background: 'rgba(255,255,255,.5)',
                borderRadius: 4,
              }}>
              Remove
            </button>
          </>
        ) : (
          <p style={{
            fontSize: 13, lineHeight: 1.5, color: '#44444c',
            fontWeight: 300, letterSpacing: '.01em',
            overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            margin: 0,
          }}>
            {text}
          </p>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Where each note sits around its bubble.
 *
 * An arc, matching how child bubbles already ring their parent, so notes look
 * native to the canvas rather than dropped on top of it. Sweeping an arc rather
 * than a full circle is what keeps the bottom of the screen clear for the notes
 * toolbar.
 */
export function fanPositions(
  count: number,
  centre: { x: number; y: number },
  bubbleRadius: number,
): { x: number; y: number }[] {
  if (count <= 0) return [];

  // An arc rather than a full circle, centred straight up and leaving the
  // bottom ninety degrees empty — that is where the notes toolbar sits, and a
  // note placed there is a note the user cannot read.
  const CENTRE = -Math.PI / 2;
  const SPAN   = Math.PI * 1.5;

  // Far enough out that a tilted note clears the bubble, and — once there are
  // several — far enough that neighbours along the arc clear each other. Same
  // chord reasoning ringRadius uses for sibling bubbles.
  const clearOfBubble = bubbleRadius + NOTE_H / 2 + 40;
  const clearOfEachOther = count > 1
    ? (NOTE_W + 26) / (2 * Math.sin(SPAN / count / 2))
    : 0;
  const radius = Math.max(clearOfBubble, clearOfEachOther);

  // Half-steps, so a lone note sits straight above rather than off at one end
  // of the arc, and the fan stays symmetrical at every count.
  return Array.from({ length: count }, (_, i) => {
    const angle = CENTRE - SPAN / 2 + ((i + 0.5) / count) * SPAN;
    return {
      x: centre.x + Math.cos(angle) * radius,
      y: centre.y + Math.sin(angle) * radius,
    };
  });
}
