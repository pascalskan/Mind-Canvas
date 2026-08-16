import { useRef } from 'react';
import { motion } from 'framer-motion';
import { archiveWash, ARCHIVE_FILL_KEEP, ARCHIVE_RING_KEEP } from '../lib/bubbleLayout';

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

/** A note never shrinks below a square-ish scrap, nor grows past a card. */
export const NOTE_MIN_H = 104;
export const NOTE_MAX_H = 330;

/**
 * How tall a note has to be to hold what is written on it.
 *
 * Estimated from the text rather than measured off the DOM, because the fan
 * and the orbit both need a height BEFORE anything is rendered — measuring
 * would mean laying out at one size, reading it back, and moving everything on
 * a second pass, which the eye catches every time.
 *
 * The estimate only has to be close: the paper itself is flexbox, so a line
 * that wraps differently than counted still sits inside the note. Being a
 * little generous is the safe direction, and a hard ceiling stops one very
 * long note from towering over the bubble it belongs to.
 */
export function noteHeight(text: string, editing = false): number {
  // Measured against the real thing, not calculated from character widths:
  // word wrapping leaves a ragged margin, so a 160px line at 13px takes far
  // fewer characters than it could fit. Twenty-four clipped a long note; this
  // errs short on purpose, which errs tall — the safe direction.
  const CHARS_PER_LINE = 19;
  const LINE_H = 20;
  const lines = text.length === 0
    ? 1
    : text.split(/\r?\n/).reduce(
        (n, line) => n + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0);
  // Padding top and bottom, plus the Remove row that only edit mode shows.
  const chrome = 31 + (editing ? 30 : 0);
  return Math.min(Math.max(chrome + lines * LINE_H, NOTE_MIN_H), NOTE_MAX_H);
}

/** Breathing room between the bubble's edge and the nearest corner of a note. */
export const NOTE_GAP = 54;

/** How far past the inner edge of the orbit a note may be pulled. */
export const ORBIT_DEPTH = 420;

/**
 * The band a note is allowed to occupy around its bubble.
 *
 * Inner edge is the clearance the fan already uses — half the note's DIAGONAL
 * past the bubble's rim, so no angle and no tilt can put paper over the bubble.
 * Outer edge stops a note being towed off across the canvas: a note belongs to
 * a bubble, and one abandoned three screens away has quietly stopped saying
 * which bubble it belongs to.
 */
export function orbitRange(bubbleRadius: number, noteH: number): { min: number; max: number } {
  const min = bubbleRadius + Math.hypot(NOTE_W, noteH) / 2 + NOTE_GAP;
  return { min, max: min + ORBIT_DEPTH };
}

/**
 * Pull an offset back into the bubble's orbit, keeping its direction.
 *
 * Angle is the user's to choose and is never touched; only distance is held.
 * So a note dragged past the outer edge slides around the bubble under the
 * cursor rather than sticking — it reads as a leash, not as a wall.
 */
export function clampToOrbit(
  dx: number, dy: number, bubbleRadius: number, noteH: number,
): { x: number; y: number } {
  const { min, max } = orbitRange(bubbleRadius, noteH);
  const dist = Math.hypot(dx, dy);
  // Dropped exactly on the centre: no direction to preserve, so park it right.
  if (dist < 1e-6) return { x: min, y: 0 };
  const held = Math.min(Math.max(dist, min), max);
  return { x: (dx / dist) * held, y: (dy / dist) * held };
}

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
  /** Double-click opens this note for writing. */
  onOpen?: () => void;
  /** Where this note currently sits, as an offset from the bubble's centre. */
  baseDx: number;
  baseDy: number;
  /** The owning bubble's radius — sets the orbit this note is held in. */
  bubbleRadius: number;
  /**
   * The bubble this note hangs off has been completed.
   *
   * A note belongs to its bubble, so a note on completed work is completed
   * work: it wears the same wash and dashed rim, and its tape comes off. Paper
   * still taped to the wall would read as live.
   */
  archived?: boolean;
  /** A finished drag, as the note's new offset from the bubble's centre. */
  onMoved?: (dx: number, dy: number) => void;
  /** World units per screen pixel — a drag must not outrun the cursor. */
  cameraScale?: number;
}

/** Past this many pixels a press is a drag, and never a click. */
const DRAG_THRESHOLD = 4;

export default function StickyNote({
  id, text, color, x, y, editing, onChange, onRemove, autoFocus,
  onOpen, onMoved, cameraScale = 1, baseDx, baseDy, bubbleRadius, archived,
}: Props) {
  const tilt   = tiltOf(id);
  const height = noteHeight(text, !!editing);

  // Drag bookkeeping. Refs rather than state: this updates on every pointer
  // move, and re-rendering the whole canvas at that rate would crawl.
  const press = useRef<
    { x: number; y: number; moved: boolean; at: { x: number; y: number } | null }
  | null>(null);
  const live  = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // While a note is open for writing the FIELD belongs to the caret —
    // pressing in it places the cursor, and dragging in it selects text. The
    // paper around the field still moves the note, so it can be repositioned
    // without first closing what you were writing.
    if (editing && (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    press.current = { x: e.clientX, y: e.clientY, moved: false, at: null };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    p.moved = true;

    // Held in the bubble's orbit as the cursor moves, not corrected on release
    // — the note has to be seen to reach its limit, or the leash is a surprise
    // that only shows up after letting go.
    const held = clampToOrbit(
      baseDx + dx / cameraScale,
      baseDy + dy / cameraScale,
      bubbleRadius,
      height,
    );
    p.at = held;
    const ox = held.x - baseDx;
    const oy = held.y - baseDy;
    // Move the element directly. The committed position is written once, on
    // release; until then this is the only thing that changes.
    //
    // Counter-rotated first: this element sits INSIDE the note's tilt, so a
    // raw translate would run along the tilted axis and the paper would drift
    // away from the cursor. The committed offset below needs no such fix — it
    // is stored against the world, outside the rotation.
    if (live.current) {
      const rad = (-tilt * Math.PI) / 180;
      const lx  = ox * Math.cos(rad) - oy * Math.sin(rad);
      const ly  = ox * Math.sin(rad) + oy * Math.cos(rad);
      live.current.style.transform = `translate(${lx}px, ${ly}px)`;
    }
  };

  const endPress = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (live.current) live.current.style.transform = '';
    if (!p.moved || !p.at) return;
    // Exactly the offset the paper was showing when released.
    onMoved?.(p.at.x, p.at.y);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: .88 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: .9 }}
      transition={{ type: 'spring', stiffness: 240, damping: 20 }}
      className="absolute top-0 left-0"
      style={{
        x: x - NOTE_W / 2,
        y: y - height / 2,
        width: NOTE_W,
        rotate: tilt,
        // Above the bubble, below the canvas chrome.
        zIndex: 400,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      // Double-click is what opens a note for writing; a single press is
      // reserved for dragging, so the two never fight over the same gesture.
      onDoubleClick={e => { e.stopPropagation(); if (!editing) onOpen?.(); }}
    >
      <div ref={live} style={{
        position: 'relative',
        cursor: editing ? 'text' : 'grab',
        // minHeight, not height: the estimate decides the layout, but if a
        // line wraps differently than counted the paper simply grows. That
        // makes clipped text impossible rather than merely unlikely.
        width: '100%', minHeight: height,
        // Archived: the same treatment its bubble gets — a pale wash of the
        // bubble's own hue behind a DASHED rim. Dashed rather than solid on
        // purpose: it is the mark the eye reads as "finished", and a solid
        // edge just looks like a differently-coloured note.
        background: archived ? archiveWash(color, ARCHIVE_FILL_KEEP) : paperOf(color),
        border: archived ? `2px dashed ${archiveWash(color, ARCHIVE_RING_KEEP)}` : undefined,
        // Explicit, so the border cannot inflate a note whose size the fan and
        // the orbit have already been measured against.
        boxSizing: 'border-box' as const,
        // No drop shadow either. Completed paper is not lifting off the wall.
        boxShadow: archived
          ? 'none'
          : '0 6px 18px rgba(40,40,50,.14), 0 1px 2px rgba(40,40,50,.10)',
        borderRadius: archived ? 3 : undefined,
        padding: '18px 15px 13px',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Archived notes are not taped up any more. */}
        {!archived && <><Tape side="left" /><Tape side="right" /></>}

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
                fontWeight: 300, letterSpacing: '.01em', cursor: 'text',
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
  heights: number[],
  centre: { x: number; y: number },
  bubbleRadius: number,
): { x: number; y: number }[] {
  const count = heights.length;
  if (count <= 0) return [];

  // An arc rather than a full circle, centred straight up and leaving the
  // bottom ninety degrees empty — that is where the notes toolbar sits, and a
  // note placed there is a note the user cannot read.
  const CENTRE = -Math.PI / 2;
  const SPAN   = Math.PI * 1.5;

  // Half the note's DIAGONAL, not half its height. A note out to the side of
  // the arc presents its width to the bubble, and a tilted one presents a
  // corner — measuring by height let both of those sit on top of the bubble,
  // which is exactly what this is here to prevent. The diagonal is the only
  // radius that holds at every angle and every tilt.
  // The tallest note sets the ring, so every note on it clears the bubble and
  // they still sit on one circle rather than a lumpy line.
  const clearOfBubble = orbitRange(bubbleRadius, Math.max(...heights)).min;
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
